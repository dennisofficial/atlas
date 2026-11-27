import { describe, expect, it } from 'bun:test'

import type { CommandContext } from '@dltech/atlas-commands'
import { EServiceStatus } from '@dltech/atlas-core'

import { serviceHandlerOf } from '../commands'
import { invoke, movedHolderOf, rig, serviceIdOf, writeDeclared } from './support'

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

const appendedOf = async (args: { harness: ReturnType<typeof rig>; input: unknown }) => {
  const appended: unknown[] = []
  await serviceHandlerOf(args.harness.ctx)({
    ...contextOf(args.input),
    append: async (drafts) => {
      appended.push(...drafts)
    },
  })
  return appended
}

describe('the outcome the service pod command records', () => {
  it('records one applied outcome naming the inbox it answers, after a stop', async () => {
    const harness = rig()
    const serviceId = await startOf(harness)
    expect(await appendedOf({ harness, input: { action: 'stop', serviceId } })).toEqual([
      { type: 'command-applied', inboxId: 9, name: 'service' },
    ])
  })

  it('records the same outcome after a restart', async () => {
    const harness = rig()
    const serviceId = await startOf(harness)
    expect(await appendedOf({ harness, input: { action: 'restart', serviceId } })).toEqual([
      { type: 'command-applied', inboxId: 9, name: 'service' },
    ])
  })

  it('records no outcome when the stop fails', async () => {
    const harness = rig()
    expect(await appendedOf({ harness, input: { action: 'stop', serviceId: 'ghost' } })).toEqual([])
  })
})

describe('a second restart of an ad-hoc service before the first ending is recorded', () => {
  it('restarts the replacement instead of refusing on the stopped id', async () => {
    const harness = rig()
    const first = await startOf(harness)
    const handle = serviceHandlerOf(harness.ctx)

    const once = await handle(contextOf({ action: 'restart', serviceId: first }))
    const twice = await handle(contextOf({ action: 'restart', serviceId: first }))

    const stops = harness.calls.flatMap((call) => (call.op === 'services.stop' ? [call] : []))
    expect([once, twice]).toEqual([{ kind: 'done' }, { kind: 'done' }])
    expect(stops).toHaveLength(2)
    expect(stops[1]?.serviceId).not.toBe(first)
  })
})

describe('a second restart of a declared service before the first ending is recorded', () => {
  it('restarts the replacement instead of refusing on the stopped id', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      ['services:', '  web:', '    command: listen', '    port: 8090'].join('\n'),
    )
    const first = serviceIdOf(
      await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'start', name: 'web' } }),
    )
    const handle = serviceHandlerOf(harness.ctx)

    const once = await handle(contextOf({ action: 'restart', serviceId: first }))
    const twice = await handle(contextOf({ action: 'restart', serviceId: first }))

    const stops = harness.calls.flatMap((call) => (call.op === 'services.stop' ? [call] : []))
    expect([once, twice]).toEqual([{ kind: 'done' }, { kind: 'done' }])
    expect(stops).toHaveLength(2)
    expect(stops[1]?.serviceId).not.toBe(first)
  })
})

const startedIdsOf = (harness: ReturnType<typeof rig>): string[] =>
  harness.log.flatMap((event) => (event.type === 'service-started' ? [event.serviceId] : []))

const replacesOf = (harness: ReturnType<typeof rig>): (string | undefined)[] =>
  harness.log.flatMap((event) => (event.type === 'service-started' ? [event.replaces] : []))

const stoppedIdsOf = (harness: ReturnType<typeof rig>): string[] =>
  harness.calls.flatMap((call) => (call.op === 'services.stop' ? [call.serviceId] : []))

const secondOf = (harness: ReturnType<typeof rig>): string => {
  const second = startedIdsOf(harness)[1]
  if (second === undefined) throw new Error('the first restart launched nothing')
  return second
}

const endedInLog = async (harness: ReturnType<typeof rig>, serviceId: string): Promise<void> => {
  await harness.ctx.append([
    {
      type: 'service-ended',
      serviceId,
      command: 'listen',
      status: EServiceStatus.Killed,
      tail: '',
    },
  ])
}

describe('a restart of an ad-hoc service after the session moved to another holder', () => {
  it('restarts the newest replacement instead of launching a duplicate', async () => {
    const harness = rig()
    const first = await startOf(harness)
    await serviceHandlerOf(harness.ctx)(contextOf({ action: 'restart', serviceId: first }))
    const second = secondOf(harness)
    await endedInLog(harness, first)
    const moved = movedHolderOf(harness)

    const result = await serviceHandlerOf(moved)(contextOf({ action: 'restart', serviceId: first }))

    expect(result).toEqual({ kind: 'done' })
    expect(stoppedIdsOf(harness)).toEqual([first, second])
    expect(startedIdsOf(harness)).toHaveLength(3)
    expect(replacesOf(harness)).toEqual([undefined, first, second])
  })
})

describe('a restart of a declared service after the session moved to another holder', () => {
  it('links the replacement chain in the log rather than in the holder that launched it', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      ['services:', '  web:', '    command: listen', '    port: 8090'].join('\n'),
    )
    const first = serviceIdOf(
      await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'start', name: 'web' } }),
    )
    await serviceHandlerOf(harness.ctx)(contextOf({ action: 'restart', serviceId: first }))
    const second = secondOf(harness)
    await endedInLog(harness, first)
    const moved = movedHolderOf(harness)

    const result = await serviceHandlerOf(moved)(contextOf({ action: 'restart', serviceId: first }))

    expect(result).toEqual({ kind: 'done' })
    expect(stoppedIdsOf(harness)).toEqual([first, second])
    expect(startedIdsOf(harness)).toHaveLength(3)
    expect(replacesOf(harness)).toEqual([undefined, first, second])
  })
})
