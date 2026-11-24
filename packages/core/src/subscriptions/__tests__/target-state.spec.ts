import { describe, expect, it } from 'bun:test'

import { EPullRequestState, EPrEventKind } from '../../events/body'
import {
  ETargetPhase,
  type SubscriptionSnapshot,
  subscribedTargetOf,
  subscribedTargetText,
} from '../target-state'

const SNAPSHOT: SubscriptionSnapshot = {
  facts: ['ready for review, head a1b2c3d', 'mergeable'],
  next: 'No CI notice comes for this head.',
}

describe('subscribedTargetText', () => {
  it('renders the summary, then each fact, then the next notice', () => {
    const target = subscribedTargetOf({
      phase: ETargetPhase.Open,
      summary: 'Pull request acme/atlas#7 is open.',
      snapshot: SNAPSHOT,
    })

    expect(subscribedTargetText(target)).toBe(
      ' Pull request acme/atlas#7 is open.\nready for review, head a1b2c3d\nmergeable\nNo CI notice comes for this head.',
    )
  })

  it('renders only the summary when the provider has no snapshot', () => {
    const target = subscribedTargetOf({
      phase: ETargetPhase.Open,
      summary: 'Pull request acme/atlas#7 is open.',
    })

    expect(subscribedTargetText(target)).toBe(' Pull request acme/atlas#7 is open.')
  })

  it('keeps the terminal text unchanged', () => {
    const target = subscribedTargetOf({
      phase: ETargetPhase.Terminal,
      summary: 'Pull request acme/atlas#7 is already merged.',
      notice: {
        type: 'pr-event',
        repo: 'github.com/acme/atlas',
        prNumber: 7,
        kind: EPrEventKind.State,
        url: 'https://github.com/acme/atlas/pull/7',
        state: EPullRequestState.Merged,
      },
    })

    expect(subscribedTargetText(target)).toBe(
      ' Pull request acme/atlas#7 is already merged. Its final notice arrives now, and the subscription ended.',
    )
  })

  it('renders nothing without a target', () => {
    expect(subscribedTargetText(undefined)).toBe('')
    expect(subscribedTargetText(subscribedTargetOf({ phase: ETargetPhase.Unknown }))).toBe('')
  })
})
