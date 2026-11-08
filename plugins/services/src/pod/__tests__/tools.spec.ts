import { describe, expect, it } from 'bun:test'

import { servicesPod } from '..'
import { invoke, rig, serviceIdOf, settle, textOf } from './support'

const start = async (
  harness: ReturnType<typeof rig>,
  input: Record<string, unknown> = { description: 'web', command: 'listen', port: 3000 },
) => {
  const outcome = await invoke({ ctx: harness.ctx, name: 'service_start', input })
  return { outcome, serviceId: serviceIdOf(outcome) }
}

describe('service tools', () => {
  it('declares the four tools', () => {
    const { ctx } = rig()
    expect(servicesPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'service_start',
      'service_stop',
      'service_restart',
      'service_list',
    ])
  })

  it('service_start launches in the workdir, records the start and returns an id', async () => {
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

  it('service_start falls back to the project directory and surfaces a daemon failure', async () => {
    const harness = rig()
    await start(harness)
    expect(harness.calls[0]).toMatchObject({ cwd: '/work' })
    const failed = await invoke({
      ctx: harness.ctx,
      name: 'service_start',
      input: { description: 'x', command: 'listen', workdir: '/missing' },
    })
    expect(failed.ok).toBe(false)
    expect(harness.log.filter((event) => event.type === 'service-started')).toHaveLength(1)
  })

  it('service_stop stops it and the ending is recorded once as a model stop', async () => {
    const harness = rig()
    harness.ctx.onDaemonEvent(() => undefined)
    const { serviceId } = await start(harness)
    const stopped = await invoke({ ctx: harness.ctx, name: 'service_stop', input: { serviceId } })
    expect(textOf(stopped)).toContain('recorded and delivered on its own')
    expect(harness.calls.at(-1)).toMatchObject({ op: 'services.stop', serviceId })
  })

  it('service_stop reports an unknown id', async () => {
    const harness = rig()
    const stopped = await invoke({
      ctx: harness.ctx,
      name: 'service_stop',
      input: { serviceId: 'svc-nope' },
    })
    expect(stopped.ok).toBe(false)
    expect(textOf(stopped)).toContain('no such service')
  })

  it('service_restart stops, then starts again with the same command, port and cwd', async () => {
    const harness = rig()
    const { serviceId } = await start(harness, {
      description: 'web',
      command: 'listen',
      workdir: '/elsewhere',
      port: 3000,
    })
    const restarted = await invoke({
      ctx: harness.ctx,
      name: 'service_restart',
      input: { serviceId },
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

  it('service_restart refuses an unknown id', async () => {
    const harness = rig()
    const refused = await invoke({
      ctx: harness.ctx,
      name: 'service_restart',
      input: { serviceId: 'svc-nope' },
    })
    expect(refused.ok).toBe(false)
    expect(textOf(refused)).toContain('no service is registered as "svc-nope"')
  })

  it('service_list renders running and ended services and honours runningOnly', async () => {
    const harness = rig()
    const empty = await invoke({ ctx: harness.ctx, name: 'service_list', input: {} })
    expect(textOf(empty)).toContain('No service has been started')
    const { serviceId: web } = await start(harness)
    const { serviceId: job } = await start(harness, { description: 'job', command: 'echo hi' })
    await settle()
    const all = await invoke({ ctx: harness.ctx, name: 'service_list', input: {} })
    expect(textOf(all).split('\n')).toEqual([
      `${web}  "web" (\`listen\`)  running  port 3000`,
      `${job}  "job" (\`echo hi\`)  ended`,
    ])
    const running = await invoke({
      ctx: harness.ctx,
      name: 'service_list',
      input: { runningOnly: true },
    })
    expect(textOf(running)).toBe(`${web}  "web" (\`listen\`)  running  port 3000`)
  })
})
