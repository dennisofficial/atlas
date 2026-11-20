import { describe, expect, it } from 'bun:test'
import { EToolEffect } from '@dltech/atlas-core'

import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'

import { servicesPod } from '..'
import { servicesOfEvents } from '../../core'
import {
  controlOf,
  invoke,
  rig,
  serviceIdOf,
  settle,
  startsOf,
  textOf,
  writeDeclared,
} from './support'

const DECLARED = ['services:', '  web:', '    command: listen', '    port: 3000'].join('\n')

const start = async (
  harness: ReturnType<typeof rig>,
  input: Record<string, unknown> = { description: 'web', command: 'listen', port: 3000 },
) => {
  const outcome = await invoke({
    ctx: harness.ctx,
    name: 'service',
    input: { action: 'start', ...input },
  })
  return { outcome, serviceId: serviceIdOf(outcome) }
}

describe('the service tool', () => {
  it('declares one tool', () => {
    const { ctx } = rig()
    expect(servicesPod.tools?.(ctx).map((tool) => tool.name)).toEqual(['service'])
  })

  it('writes, and only list is concurrency safe', () => {
    const { ctx } = rig()
    const tool = servicesPod.tools?.(ctx)[0]
    expect(tool?.effect).toBe(EToolEffect.Write)
    expect(tool?.isConcurrencySafe?.({ action: 'list' })).toBe(true)
    expect(tool?.isConcurrencySafe?.({ action: 'start' })).toBe(false)
  })

  it('keeps the lifecycle rules the model needs, and names every action', () => {
    const { ctx } = rig()
    const description = servicesPod.tools?.(ctx)[0]?.description ?? ''
    expect(description.length).toBeLessThanOrEqual(1_400)
    expect(description).toContain('never times out')
    expect(description).toContain('give the operator that URL')
    expect(description).toContain('Restart after editing what it runs')
    expect(description).toContain('needs first')
    for (const action of ['start', 'stop', 'restart', 'list']) {
      expect(description).toContain(`- ${action}`)
    }
  })

  it('start launches in the workdir, records the start and returns an id', async () => {
    const harness = rig()
    const { outcome, serviceId } = await start(harness, {
      description: 'web',
      command: 'listen',
      workdir: '/elsewhere',
      port: 3000,
    })
    expect(serviceId).toMatch(/^svc-[0-9a-f]{8}$/)
    expect(harness.calls[0]).toMatchObject({
      op: 'services.start',
      serviceId,
      cwd: '/elsewhere',
      port: 3000,
    })
    expect(harness.log[0]).toMatchObject({
      type: 'service-started',
      serviceId,
      command: 'listen',
      description: 'web',
      port: 3000,
    })
    expect(textOf(outcome)).toContain('do not poll')
  })

  it('start falls back to the project directory and surfaces a daemon failure', async () => {
    const harness = rig()
    await start(harness)
    expect(harness.calls[0]).toMatchObject({ cwd: '/work' })
    const failed = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', description: 'x', command: 'listen', workdir: '/missing' },
    })
    expect(failed.ok).toBe(false)
    expect(harness.log.filter((event) => event.type === 'service-started')).toHaveLength(1)
  })

  it('stop stops it and the ending is recorded once as a model stop', async () => {
    const harness = rig()
    harness.ctx.onDaemonEvent(() => undefined)
    const { serviceId } = await start(harness)
    const stopped = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'stop', serviceId },
    })
    expect(textOf(stopped)).toContain('recorded and delivered on its own')
    expect(harness.calls.filter((call) => call.op === 'services.stop')).toMatchObject([
      { serviceId },
    ])
    expect(harness.calls.at(-1)).toMatchObject({ op: 'previews.stop', port: 3000 })
  })

  it('stop reports an unknown id', async () => {
    const harness = rig()
    const stopped = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'stop', serviceId: 'svc-nope' },
    })
    expect(stopped.ok).toBe(false)
    expect(textOf(stopped)).toContain('no such service')
  })

  it('restart stops, then starts again with the same command, port and cwd', async () => {
    const harness = rig()
    const { serviceId } = await start(harness, {
      description: 'web',
      command: 'listen',
      workdir: '/elsewhere',
      port: 3000,
    })
    const restarted = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', serviceId },
    })
    const next = serviceIdOf(restarted)
    expect(next).not.toBe(serviceId)
    expect(harness.calls.filter((call) => call.op === 'services.stop')).toMatchObject([
      { serviceId },
    ])
    expect(harness.calls.filter((call) => call.op === 'services.start')[1]).toMatchObject({
      command: 'listen',
      cwd: '/elsewhere',
      port: 3000,
    })
    expect(harness.log.filter((event) => event.type === 'service-started')).toMatchObject([
      { serviceId, description: 'web' },
      { serviceId: next, description: 'web', command: 'listen', port: 3000 },
    ])
  })

  it('restart refuses an unknown id', async () => {
    const harness = rig()
    const refused = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', serviceId: 'svc-nope' },
    })
    expect(refused.ok).toBe(false)
    expect(textOf(refused)).toContain('no service is registered as "svc-nope"')
  })

  it('list renders running and ended services and honours runningOnly', async () => {
    const harness = rig()
    const empty = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'list' } })
    expect(textOf(empty)).toContain('No service has been started')
    const { serviceId: web } = await start(harness)
    const { serviceId: job } = await start(harness, { description: 'job', command: 'echo hi' })
    await settle()
    const all = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'list' } })
    expect(textOf(all).split('\n')).toEqual([
      `${web}  "web" (\`listen\`)  running  port 3000`,
      `${job}  "job" (\`echo hi\`)  ended`,
    ])
    const running = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'list', runningOnly: true },
    })
    expect(textOf(running)).toBe(`${web}  "web" (\`listen\`)  running  port 3000`)
  })

  it('takes a declared name or a command, and refuses both or neither', async () => {
    const harness = rig()
    writeDeclared(harness, DECLARED)
    const both = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', name: 'web', command: 'listen' },
    })
    expect(both.ok).toBe(false)
    expect(textOf(both)).toContain('not both')
    const neither = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'start' } })
    expect(neither.ok).toBe(false)
    expect(textOf(neither)).toContain('needs a name')
    expect(harness.calls).toHaveLength(0)
  })

  it('list marks a running service whose declaration changed as stale', async () => {
    const harness = rig()
    writeDeclared(harness, DECLARED)
    await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'start', name: 'web' } })
    const fresh = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'list' } })
    expect(textOf(fresh)).not.toContain('stale')
    writeDeclared(harness, DECLARED.replace('listen', 'listen --watch'))
    const listed = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'list' } })
    expect(textOf(listed)).toContain('(stale: services.yaml changed; restart to apply)')
  })

  it('restart by name picks up a changed command', async () => {
    const harness = rig()
    writeDeclared(harness, DECLARED)
    await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'start', name: 'web' } })
    writeDeclared(harness, DECLARED.replace('listen', 'listen --watch'))
    const restarted = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', name: 'web' },
    })
    expect(textOf(restarted)).toContain('web is running as svc-')
    expect(startsOf(harness.calls).map((call) => call.command)).toEqual([
      'listen',
      'listen --watch',
    ])
    expect(harness.calls.some((call) => call.op === 'services.stop')).toBe(true)
  })

  it('restart refuses a name that is not declared', async () => {
    const harness = rig()
    writeDeclared(harness, DECLARED)
    const refused = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', name: 'nope' },
    })
    expect(refused.ok).toBe(false)
    expect(textOf(refused)).toContain('"nope" is not declared in .atlas/services.yaml')
  })

  it('start publishes a port and records the public url', async () => {
    const harness = rig({ control: controlOf({ url: 'https://six-words.trycloudflare.com' }) })
    const { outcome, serviceId } = await start(harness)
    expect(harness.log[0]).toMatchObject({
      type: 'service-started',
      serviceId,
      port: 3000,
      url: 'https://six-words.trycloudflare.com',
    })
    expect(harness.calls.find((call) => call.op === 'previews.expose')).toMatchObject({
      port: 3000,
      tunnelToken: 'tunnel-token',
    })
    expect(textOf(outcome)).toContain('https://six-words.trycloudflare.com')
    expect(JSON.stringify(harness.log)).not.toContain('tunnel-token')
    expect(JSON.stringify(outcome)).not.toContain('tunnel-token')
  })

  it('start without a port keeps the service in the sandbox', async () => {
    const harness = rig({ control: controlOf({ url: 'https://six-words.trycloudflare.com' }) })
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', description: 'job', command: 'echo hi' },
    })
    expect(outcome.ok).toBe(true)
    expect(harness.log[0]).not.toHaveProperty('url')
    expect(harness.calls.some((call) => call.op === 'previews.expose')).toBe(false)
    expect(textOf(outcome)).toContain('only reachable inside the sandbox')
  })

  it('honours exposePort false and keeps a ported service in the sandbox', async () => {
    const harness = rig({ control: controlOf({ url: 'https://six-words.trycloudflare.com' }) })
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: {
        action: 'start',
        description: 'web',
        command: 'listen',
        port: 3000,
        exposePort: false,
      },
    })
    expect(outcome.ok).toBe(true)
    expect(harness.log[0]).not.toHaveProperty('url')
    expect(harness.calls.some((call) => call.op === 'previews.expose')).toBe(false)
    expect(textOf(outcome)).toContain('only reachable inside the sandbox')
  })

  it('starts the service when publishing fails, and says it is sandbox-only', async () => {
    const harness = rig({
      control: {
        ...podControlStub,
        exposePort: async () => {
          throw new Error('the control plane is down')
        },
      },
    })
    const { outcome, serviceId } = await start(harness)
    expect(outcome.ok).toBe(true)
    expect(harness.log[0]).toMatchObject({ type: 'service-started', serviceId, port: 3000 })
    expect(harness.log[0]).not.toHaveProperty('url')
    expect(textOf(outcome)).toContain('only reachable inside the sandbox')
    expect(textOf(outcome)).toContain('the control plane is down')
  })

  it('shows the public url in the view and in the list', async () => {
    const harness = rig({ control: controlOf({ url: 'https://six-words.trycloudflare.com' }) })
    const { serviceId } = await start(harness)
    expect(servicesOfEvents(harness.log)).toMatchObject([
      { serviceId, url: 'https://six-words.trycloudflare.com' },
    ])
    const listed = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'list' } })
    expect(textOf(listed)).toContain('https://six-words.trycloudflare.com')
  })

  it('stop by name stops the running service of that name', async () => {
    const harness = rig()
    writeDeclared(harness, DECLARED)
    const started = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', name: 'web' },
    })
    const stopped = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'stop', name: 'web' },
    })
    expect(textOf(stopped)).toContain('recorded and delivered on its own')
    expect(harness.calls.filter((call) => call.op === 'services.stop')).toMatchObject([
      { serviceId: serviceIdOf(started) },
    ])
  })

  it('refuses a missing or doubled address with a message that names the action', async () => {
    const harness = rig()
    const restartNeither = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart' },
    })
    expect(textOf(restartNeither)).toContain(
      'action "restart" needs a serviceId or a declared name',
    )
    const restartBoth = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', serviceId: 'svc-1', name: 'web' },
    })
    expect(textOf(restartBoth)).toContain(
      'action "restart" takes a serviceId or a declared name, not both',
    )
    const stopNeither = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'stop' },
    })
    expect(textOf(stopNeither)).toContain('action "stop" needs a serviceId or a declared name')
  })
})
