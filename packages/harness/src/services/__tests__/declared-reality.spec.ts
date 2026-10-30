import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { EDeclaredServiceState, EKilledBy, EServiceStatus } from '@dltech/atlas-core'

import { EEnsureStatus } from '../declared-ensure'
import { open, THREAD } from './declared-fixture'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const web = (command: string): string =>
  `services:\n  web:\n    command: ${command}\n    port: 24620\n    portal: true\n`

describe('ensure brings reality to the file', () => {
  it('restarts a running service whose declaration changed', async () => {
    const { registry, processes, file } = open({ yaml: web('serve a') })
    closers.push(() => registry.closeAll())
    await registry.ensureDeclared({ threadId: THREAD })
    file.yaml = web('serve b')

    const view = await registry.declared()
    expect(view.services[0]?.state).toBe(EDeclaredServiceState.Stale)

    const again = await registry.ensureDeclared({ threadId: THREAD })
    expect(again[0]?.status).toBe(EEnsureStatus.Restarted)
    expect(again[0]?.links[0]?.url).toStartWith('https://')
    expect(processes.servicesStarted().map((one) => one.cmd[2])).toEqual(['serve a', 'serve b'])
  })

  it('fails a restart of a removed declaration without stopping it', async () => {
    const { registry, file } = open({ yaml: web('serve a') })
    closers.push(() => registry.closeAll())
    await registry.ensureDeclared({ threadId: THREAD })
    file.yaml = 'services: {}\n'

    const outcome = await registry.restart({ serviceId: registry.list()[0]?.serviceId ?? '' })

    expect(outcome.ok).toBe(false)
    expect(registry.list()[0]?.status).toBe(EServiceStatus.Running)
  })
})

describe('references', () => {
  const REFS = `services:
  app:
    command: run app
    env:
      API: "\${services.api.url}"
  api:
    command: run api
    port: 24630
`

  it('starts dependencies first and interpolates env', async () => {
    const { registry, processes } = open({ yaml: REFS })
    closers.push(() => registry.closeAll())

    const result = await registry.ensureDeclared({ threadId: THREAD })

    expect(result.map((one) => one.name)).toEqual(['api', 'app'])
    expect(processes.servicesStarted()[1]?.env?.API).toBe('http://127.0.0.1:24630')
  })

  it('rejects a cycle without spawning', async () => {
    const yaml =
      'services:\n  a:\n    command: x\n    env:\n      V: "${services.b.port}"\n  b:\n    command: y\n    env:\n      V: "${services.a.port}"\n'
    const { registry, processes } = open({ yaml })

    const result = await registry.ensureDeclared({ threadId: THREAD })

    expect(result[0]?.status).toBe(EEnsureStatus.Invalid)
    expect(processes.servicesStarted()).toHaveLength(0)
  })

  it('fails dependents of a failed dependency', async () => {
    const yaml = REFS.replace('port: 24630', 'port: 24630\n    setup:\n      - boom')
    const { registry, processes } = open({ yaml })
    processes.setupExit = 3

    const result = await registry.ensureDeclared({ threadId: THREAD })

    expect(result.map((one) => [one.name, one.status])).toEqual([
      ['api', EEnsureStatus.Failed],
      ['app', EEnsureStatus.Failed],
    ])
    expect(result[1]?.reason).toBe('depends on api, which failed')
  })
})

describe('setup', () => {
  const SETUP =
    'services:\n  db:\n    command: run db\n    port: 24640\n    setup:\n      - prep one\n'

  it('runs once per registry lifetime and not on restart', async () => {
    const { registry, processes } = open({ yaml: SETUP })
    closers.push(() => registry.closeAll())
    await registry.ensureDeclared({ threadId: THREAD })
    await registry.restart({ serviceId: registry.list()[0]?.serviceId ?? '' })
    registry.stop({ serviceId: registry.list().at(-1)?.serviceId ?? '', by: EKilledBy.User })
    await Bun.sleep(20)
    await registry.ensureDeclared({ threadId: THREAD })

    expect(processes.spawned.filter((one) => one.cmd[1] === '-lc')).toHaveLength(1)
  })

  it('blocks the start when setup fails', async () => {
    const { registry, processes } = open({ yaml: SETUP })
    processes.setupExit = 2

    const [db] = await registry.ensureDeclared({ threadId: THREAD })

    expect(db?.status).toBe(EEnsureStatus.Failed)
    expect(db?.reason).toContain('setup "prep one" exited 2')
    expect(processes.servicesStarted()).toHaveLength(0)
  })
})

describe('declared view and watch', () => {
  it('reports a never-started service as stopped', async () => {
    const { registry } = open()
    const view = await registry.declared()
    expect(view.services.map((one) => one.state)).toEqual([
      EDeclaredServiceState.Stopped,
      EDeclaredServiceState.Stopped,
    ])
    expect(await registry.declaredNames()).toEqual(['web', 'worker'])
  })

  it('bumps the change feed when services.yaml changes', async () => {
    const { registry, root } = open()
    closers.push(() => registry.closeAll())
    mkdirSync(join(root, '.atlas'), { recursive: true })
    await registry.declared()
    const before = registry.version()

    writeFileSync(join(root, '.atlas', 'services.yaml'), 'services: {}\n')
    await Bun.sleep(150)

    expect(registry.version()).toBeGreaterThan(before)
  })
})
