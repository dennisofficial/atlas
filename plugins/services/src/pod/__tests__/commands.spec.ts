import { describe, expect, it } from 'bun:test'

import type { CommandContext } from '@dltech/atlas-commands'

import { serviceHandlerOf } from '../commands'
import { invoke, rig, serviceIdOf } from './support'

const contextOf = (args: unknown): CommandContext<unknown> => ({
  args,
  sessionId: 's1',
  inboxId: 9,
  visibleEvents: () => [],
  logEvents: () => [],
  runningChildren: () => 0,
  append: async () => undefined,
  log: () => undefined,
})

const startOf = async (harness: ReturnType<typeof rig>): Promise<string> => {
  const outcome = await invoke({
    ctx: harness.ctx,
    name: 'service',
    input: { action: 'start', description: 'web', command: 'listen', port: 3000 },
  })
  return serviceIdOf(outcome)
}

describe('the service pod command', () => {
  it('stops the named service through the daemon', async () => {
    const harness = rig()
    const serviceId = await startOf(harness)

    const result = await serviceHandlerOf(harness.ctx)(contextOf({ action: 'stop', serviceId }))

    expect(result).toEqual({ kind: 'done' })
    expect(harness.calls.at(-1)).toMatchObject({ op: 'services.stop', serviceId })
  })

  it('restarts the named service through the daemon', async () => {
    const harness = rig()
    const serviceId = await startOf(harness)

    const result = await serviceHandlerOf(harness.ctx)(contextOf({ action: 'restart', serviceId }))

    expect(result).toEqual({ kind: 'done' })
    expect(harness.calls.slice(1).map((call) => call.op)).toEqual([
      'services.stop',
      'services.start',
    ])
  })

  it('refuses with the daemon sentence when the stop fails', async () => {
    const harness = rig()

    const result = await serviceHandlerOf(harness.ctx)(
      contextOf({ action: 'stop', serviceId: 'ghost' }),
    )

    expect(result).toEqual({ kind: 'refused', reason: 'no such service: ghost' })
  })

  it('refuses a restart of a service it has never seen', async () => {
    const harness = rig()

    const result = await serviceHandlerOf(harness.ctx)(
      contextOf({ action: 'restart', serviceId: 'ghost' }),
    )

    expect(result).toEqual({ kind: 'refused', reason: 'no service is registered as "ghost"' })
  })

  it('refuses arguments that do not parse', async () => {
    const harness = rig()

    const empty = await serviceHandlerOf(harness.ctx)(contextOf({ action: 'stop', serviceId: '' }))
    const unknown = await serviceHandlerOf(harness.ctx)(contextOf({ action: 'list' }))
    const absent = await serviceHandlerOf(harness.ctx)(contextOf({ action: 'stop' }))

    expect(empty.kind).toBe('refused')
    expect(unknown.kind).toBe('refused')
    expect(absent).toEqual({ kind: 'refused', reason: 'Name the service: /service stop <id>' })
    expect(harness.calls).toEqual([])
  })
})
