import { describe, expect, it } from 'bun:test'

import { declaredServicesOf } from '../../core'
import { invoke, rig, startsOf, textOf, writeDeclared } from './support'

const TWO = [
  'services:',
  '  db:',
  '    command: dbserve',
  '  api:',
  '    command: listen',
  '    needs:',
  '      - db',
].join('\n')

const hashOf = (content: string, name: string): string => {
  const declared = declaredServicesOf(content)
  if (!declared.ok) throw new Error(declared.reason)
  const hash = declared.value.hashes.get(name)
  if (hash === undefined) throw new Error(`no hash for ${name}`)
  return hash
}

describe('a declared service start', () => {
  it('starts what the service needs first and records the name and hash', async () => {
    const harness = rig()
    writeDeclared(harness, TWO)
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service_start',
      input: { name: 'api' },
    })
    expect(textOf(outcome)).toContain('api is running as svc-')
    expect(startsOf(harness.calls).map((call) => call.command)).toEqual(['dbserve', 'listen'])
    expect(harness.log.filter((event) => event.type === 'service-started')).toMatchObject([
      { command: 'dbserve', name: 'db' },
      { command: 'listen', name: 'api', declarationHash: hashOf(TWO, 'api') },
    ])
  })

  it('passes the declared health path and env to the daemon', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      [
        'services:',
        '  web:',
        '    command: listen',
        '    port: 3000',
        '    health: /healthz',
        '    env:',
        '      MODE: dev',
      ].join('\n'),
    )
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service_start',
      input: { name: 'web' },
    })
    expect(textOf(outcome)).toContain('web is running as svc-')
    expect(startsOf(harness.calls)[0]).toMatchObject({
      command: 'listen',
      cwd: '/work',
      env: { MODE: 'dev' },
      port: 3000,
      healthPath: '/healthz',
    })
  })

  it('runs setup once per name, even when the service is ensured twice', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      ['services:', '  web:', '    command: listen', '    setup:', '      - echo installing'].join(
        '\n',
      ),
    )
    await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'web' } })
    await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'web' } })
    expect(harness.calls.filter((call) => call.op === 'exec')).toHaveLength(1)
    expect(startsOf(harness.calls)).toHaveLength(1)
  })

  it('runs setup with the declared env, so a setup sees the same variables as the service', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      [
        'services:',
        '  web:',
        '    command: listen',
        '    env:',
        '      MODE: dev',
        '    setup:',
        '      - echo installing',
      ].join('\n'),
    )
    await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'web' } })
    const setupCalls = harness.calls.filter((call) => call.op === 'exec')
    expect(setupCalls).toHaveLength(1)
    expect(setupCalls[0]).toMatchObject({ cwd: '/work', env: { MODE: 'dev' } })
  })

  it('starts a declared service with the session env under the declaration env', async () => {
    const harness = rig({ env: { API_KEY: 'project-secret', MODE: 'session' } })
    writeDeclared(
      harness,
      [
        'services:',
        '  web:',
        '    command: listen',
        '    env:',
        '      MODE: dev',
        '    setup:',
        '      - echo installing',
      ].join('\n'),
    )
    await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'web' } })

    expect(startsOf(harness.calls)[0]).toMatchObject({
      env: { API_KEY: 'project-secret', MODE: 'dev' },
    })
    expect(harness.calls.filter((call) => call.op === 'exec')[0]).toMatchObject({
      env: { API_KEY: 'project-secret', MODE: 'dev' },
    })
  })

  it('stops and reports the output tail when setup fails', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      [
        'services:',
        '  web:',
        '    command: listen',
        '    setup:',
        '      - echo boom; exit 3',
      ].join('\n'),
    )
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service_start',
      input: { name: 'web' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('exited 3')
    expect(textOf(outcome)).toContain('boom')
    expect(startsOf(harness.calls)).toHaveLength(0)
  })

  it('starts nothing for an unchanged service that is already running', async () => {
    const harness = rig()
    writeDeclared(harness, TWO)
    await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'api' } })
    const again = await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'api' } })
    expect(textOf(again)).toContain('api was already running as svc-')
    expect(startsOf(harness.calls)).toHaveLength(2)
  })

  it('restarts a service whose declaration changed', async () => {
    const harness = rig()
    writeDeclared(harness, TWO)
    const first = await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'api' } })
    writeDeclared(harness, TWO.replace('command: listen', 'command: listen --watch'))
    const second = await invoke({ ctx: harness.ctx, name: 'service_start', input: { name: 'api' } })
    expect(textOf(second)).toContain('api is running as svc-')
    expect(startsOf(harness.calls).map((call) => call.command)).toContain('listen --watch')
    expect(harness.calls.some((call) => call.op === 'services.stop')).toBe(true)
    expect(textOf(first)).not.toBe(textOf(second))
  })

  it('refuses an unknown name and names the declared ones', async () => {
    const harness = rig()
    writeDeclared(harness, TWO)
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service_start',
      input: { name: 'nope' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('declared services: api, db')
  })

  it('refuses a project with no services.yaml', async () => {
    const harness = rig()
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service_start',
      input: { name: 'api' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('there is no readable /work/.atlas/services.yaml')
  })
})
