import { describe, it } from 'bun:test'

describe.skip('a lift whose cloud runtime answers activated: false after ownership committed', () => {
  // slice 08: every case here drives the lift's activate step through /container cloud and then
  // recovers or descends the unfinished move with /container off; neither entry point moves a
  // thread anymore.
  it('keeps the committed cloud binding and says so on screen instead of reporting a failed move', () => {})
  it('holds the warning as one sticky warn notice that outlives the move overlay', () => {})
  it('binds the cloud runtime with no local fallback and leaves the committed move for recovery to retry', () => {})
  it('recovers the unfinished move on /container off when activation succeeds the second time, then descends when asked again', () => {})
  it('answers /container off with a move-underway reply, and neither recovers nor descends, when this process still runs the unfinished move', () => {})
  it('keeps the source in the cloud and the move unfinished when activation is refused every time, retrying on each ask', () => {})
  it('stays silent when the runtime activates', () => {})
})
