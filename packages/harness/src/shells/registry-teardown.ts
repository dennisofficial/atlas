import { EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { EShellShutdownIntent, KILL_SETTLE_MS, withinDeadline, type RegistryState, type Tracked } from './registry-entries'

const GIVE_UP_SETTLE_MS = 30_000

export async function removeShells(args: {
  state: RegistryState
  threadId: ThreadId
  shellIds: readonly string[]
  by: EKilledBy
}): Promise<void> {
  const { state } = args
  const removed: Tracked[] = []
  for (const shellId of args.shellIds) {
    const entry = state.entryFor({ shellId, threadId: args.threadId })
    if (entry === undefined) continue
    entry.announced = true
    const id = entry.shell.shellId
    if (entry.shell.snapshot().status === 'running') entry.shell.kill(args.by)
    const died = await withinDeadline({
      promise: entry.shell.exited.catch(() => undefined),
      ms: KILL_SETTLE_MS,
    })
    if (!died) {
      entry.announced = false
      throw new Error(`shell ${id} has not stopped, so its history cannot be removed`)
    }
    await state.journal?.disown({ threadId: args.threadId, shellId: id })
    removed.push(entry)
    state.tracked.delete(id)
    state.endings.delete(id)
    state.pendingKills.delete(id)
    state.releaseAssertion(id)
    await entry.shell.detach()
  }
  if (removed.length === 0) return
  state.notices.dropShells({ threadId: args.threadId, shellIds: args.shellIds })
  state.bump()
}

async function release(args: { state: RegistryState; held: readonly Tracked[] }): Promise<void> {
  const { state } = args
  for (const id of [...state.releases.keys()]) state.releaseAssertion(id)
  await Promise.all(args.held.map((entry) => entry.shell.detach()))
  state.tracked.clear()
  state.endings.clear()
  state.pendingKills.clear()
  state.stopTimers()
  state.closed = true
}

async function settleEndings(state: RegistryState): Promise<void> {
  while (state.endingSettlements.size > 0) await Promise.all([...state.endingSettlements])
  await state.journal?.flush()
}

function shutdownOnce(args: {
  state: RegistryState
  intent: EShellShutdownIntent
  prepare?: (() => Promise<void>) | undefined
  teardown: () => Promise<void>
}): Promise<void> {
  const { state } = args
  if (state.shutdown !== undefined) return state.shutdown
  if (state.closed) return Promise.resolve()
  state.shutdownIntent ??= args.intent
  const pending = Promise.resolve()
    .then(args.prepare)
    .then(() => Promise.allSettled([...state.pendingStarts]))
    .then(args.teardown)
  state.shutdown = pending
  return pending
}

export function closeAllShells(args: {
  state: RegistryState
  killedBy: EKilledBy
  prepare?: (() => Promise<void>) | undefined
}): Promise<void> {
  return shutdownOnce({
    state: args.state,
    intent: EShellShutdownIntent.Close,
    prepare: args.prepare,
    teardown: () => stopAllShells(args),
  })
}

async function stopAllShells(args: { state: RegistryState; killedBy: EKilledBy }): Promise<void> {
  const { state } = args
  const held = [...state.tracked.values()]
  for (const entry of held) entry.shell.kill(args.killedBy)
  const deaths = await Promise.all(
    held.map((entry) =>
      withinDeadline({ promise: entry.shell.exited, ms: GIVE_UP_SETTLE_MS }),
    ),
  )
  const stragglers = held.filter((_, index) => deaths[index] !== true)
  if (stragglers.length > 0) {
    throw new Error(`shells have not stopped: ${stragglers.map((entry) => entry.shell.shellId).join(', ')}`)
  }
  await settleEndings(state)
  await release({ state, held })
}

export function detachAllShells(state: RegistryState): Promise<void> {
  return shutdownOnce({
    state,
    intent: EShellShutdownIntent.Detach,
    teardown: async () => {
      const held = [...state.tracked.values()]
      await settleEndings(state)
      await release({ state, held })
    },
  })
}

export async function abandonShell(args: { state: RegistryState; entry: Tracked }): Promise<void> {
  const { state, entry } = args
  const id = entry.shell.shellId
  entry.announced = true
  void state.journal?.disown({ threadId: entry.threadId, shellId: id })
  state.tracked.delete(id)
  state.releaseAssertion(id)
  entry.shell.kill(EKilledBy.SessionEnd)
  await withinDeadline({ promise: entry.shell.exited.catch(() => undefined), ms: KILL_SETTLE_MS })
  await entry.shell.detach()
  state.bump()
}
