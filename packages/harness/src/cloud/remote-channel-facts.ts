import { ERuntimePhase } from '@dltech/atlas-wire'

import type { Unsubscribe } from '../channel/delta-channel'
import { connectionViewOf, sameConnectionView, type ConnectionFacts, type ConnectionView } from './connection-view'
import { registryOf } from './remote-channel-registry'

export const DEFAULT_MAX_ATTEMPTS = 5

/** A serve swap downloads a fresh binary before it listens again, so its window outlasts a restart. */
export const UPDATING_MAX_ATTEMPTS = 10

export const attemptBudgetFor = (args: { phase: ERuntimePhase | null; maxAttempts: number }): number =>
  args.phase === ERuntimePhase.Updating ? UPDATING_MAX_ATTEMPTS : args.maxAttempts

export const exhaustedDetailOf = (attempts: number): string =>
  `The session socket closed and did not reopen after ${attempts} attempts.`

export type ConnectionFactsCell = {
  facts(): ConnectionFacts
  view(): ConnectionView
  update(change: Partial<ConnectionFacts>): void
  onView(listener: (view: ConnectionView) => void): Unsubscribe
}

export function createConnectionFacts(initial: ConnectionFacts): ConnectionFactsCell {
  let facts = initial
  let view = connectionViewOf(facts)
  const views = registryOf<ConnectionView>()

  return {
    facts: () => facts,
    view: () => view,
    update(change) {
      facts = { ...facts, ...change }
      const next = connectionViewOf(facts)
      if (sameConnectionView({ left: view, right: next })) return
      view = next
      views.emit(next)
    },
    onView: (listener) => views.add(listener),
  }
}
