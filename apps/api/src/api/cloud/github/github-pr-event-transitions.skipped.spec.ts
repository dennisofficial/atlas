import { describe, expect, it } from 'bun:test'
import { EPrEventKind } from './github-realtime.types'
import { transitionsOf, type PrTransitionSnapshot } from './github-pr-event-transitions'

const base = { state: 'open', headSha: 'abc', url: 'https://x' }

const running: PrTransitionSnapshot = {
  state: 'open',
  headSha: 'abc',
  checksRunning: 2,
  checksPassed: 0,
  checksFailed: 0,
  checksIgnored: 0,
  mergeable: null,
}

describe('transitionsOf for an all-skipped head', () => {
  it('settles green when running clears and every check was skipped', () => {
    const events = transitionsOf({
      prior: running,
      next: {
        ...base,
        checksRunning: 0,
        checksPassed: 0,
        checksFailed: 0,
        checksIgnored: 2,
        mergeable: null,
      },
    })
    expect(events.map((event) => event.kind)).toEqual([EPrEventKind.Verdict])
    expect(events[0]?.payload).toMatchObject({ verdict: 'green', settled: true })
  })

  it('does not settle on 0/0/0/0', () => {
    const events = transitionsOf({
      prior: running,
      next: {
        ...base,
        checksRunning: 0,
        checksPassed: 0,
        checksFailed: 0,
        checksIgnored: 0,
        mergeable: null,
      },
    })
    expect(events).toEqual([])
  })
})
