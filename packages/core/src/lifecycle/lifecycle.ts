import type { Event } from '../events/envelope'

export enum ELifecycleState {
  Open = 'open',
  Settled = 'settled',
  Lost = 'lost',
}

export type Lifecycle<TStart extends Event = Event, TEnd extends Event = Event> = {
  key: string
  state: ELifecycleState
  started: TStart
  ending?: TEnd | undefined
}

/**
 * How one kind of long-running thing maps onto the log: which events open and close it, what
 * identifies one instance, and what scopes an open to a close. `keyOf` is the identity that recycles
 * (a shellId, a serviceId); `scopeOf` is what keeps one process's instance from settling another's —
 * the bootId for shells, the unique ThreadId for agents, which never recycles and so scopes to
 * itself.
 */
export type LifecycleKind<TStart extends Event, TEnd extends Event> = {
  isStart(event: Event): event is TStart
  isEnd(event: Event): event is TEnd
  keyOf(event: TStart | TEnd): string
  scopeOf(event: TStart | TEnd): string
}

const scopedKey = <TStart extends Event, TEnd extends Event>(
  kind: LifecycleKind<TStart, TEnd>,
  event: TStart | TEnd,
): string => `${kind.scopeOf(event)}${kind.keyOf(event)}`

/**
 * The one module that pairs a long-running thing's opens to its closes over an event stream, and
 * therefore which of them still need a close written. Shells, services, and agents each used to
 * scan the log with a private pairing rule, and the rules disagreed; the decision is pure — it reads
 * only the events — so it lives here and the three callers become thin projections supplying a
 * `LifecycleKind`. Pairing is keyed on (scope, id): within one scope an id can recycle, so opens
 * queue FIFO and a close settles the oldest open one; a different scope's close can never settle
 * this scope's open.
 */
export function lifecycleOf<TStart extends Event, TEnd extends Event>(
  events: readonly Event[],
  kind: LifecycleKind<TStart, TEnd>,
): Lifecycle<TStart, TEnd>[] {
  const lifecycles: Lifecycle<TStart, TEnd>[] = []
  const openByKey = new Map<string, Lifecycle<TStart, TEnd>[]>()

  const enqueue = (started: TStart): void => {
    const lifecycle: Lifecycle<TStart, TEnd> = {
      key: kind.keyOf(started),
      state: ELifecycleState.Open,
      started,
    }
    lifecycles.push(lifecycle)

    const scoped = scopedKey(kind, started)
    const queue = openByKey.get(scoped) ?? []
    queue.push(lifecycle)
    openByKey.set(scoped, queue)
  }

  const settle = (ended: TEnd): void => {
    const scoped = scopedKey(kind, ended)
    const queue = openByKey.get(scoped)
    const open = queue?.shift()
    if (queue !== undefined && queue.length === 0) openByKey.delete(scoped)
    if (open === undefined) return
    open.state = ELifecycleState.Settled
    open.ending = ended
  }

  for (const event of events) {
    if (kind.isStart(event)) enqueue(event)
    else if (kind.isEnd(event)) settle(event)
  }

  for (const lifecycle of lifecycles) {
    if (lifecycle.state === ELifecycleState.Open) lifecycle.state = ELifecycleState.Lost
  }

  return lifecycles
}

export const lostOf = <TStart extends Event, TEnd extends Event>(
  events: readonly Event[],
  kind: LifecycleKind<TStart, TEnd>,
): Lifecycle<TStart, TEnd>[] =>
  lifecycleOf(events, kind).filter((lifecycle) => lifecycle.state === ELifecycleState.Lost)

/**
 * The pairing keys of every recorded close, for a teardown that asks "is this one's end already in
 * the log". A close counts even when its open is not in the log — the case where the drain wrote a
 * close for a thing whose open a compaction dropped — so this reads the raw close events rather than
 * the paired lifecycles, which an orphan close never enters.
 */
export const endedKeysOf = <TStart extends Event, TEnd extends Event>(
  events: readonly Event[],
  kind: LifecycleKind<TStart, TEnd>,
): ReadonlySet<string> => {
  const ended = new Set<string>()
  for (const event of events) {
    if (kind.isEnd(event)) ended.add(scopedKey(kind, event))
  }
  return ended
}
