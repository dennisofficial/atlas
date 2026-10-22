import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EChecksState, EPullRequestLookup, type RepositoryCheckout } from '../pure'
import { pendingCiSource } from '../pending-ci-source'
import { aCheckout, aPullRequest, WAS_ABSENT } from '../testing'
import type { PullRequestReading } from '../pure'

const THREAD = toThreadId('thread-ci')

const sourceFor = (args: { checkout: RepositoryCheckout | null; reading: PullRequestReading }) =>
  pendingCiSource({
    service: { snapshot: () => args.reading },
    tracker: { checkoutFor: () => args.checkout },
  })

const found = (checks: EChecksState): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: aPullRequest({ number: 1366, checks }),
})

describe('the pending CI live-work source', () => {
  it('holds a thread open while its pull request checks are running', () => {
    const source = sourceFor({ checkout: aCheckout(), reading: found(EChecksState.Running) })

    expect(source(THREAD)).toBe('CI on #1366')
  })

  it.each([EChecksState.Passing, EChecksState.Failing, EChecksState.None])(
    'never holds a thread open when the checks are %s',
    (checks) => {
      const source = sourceFor({ checkout: aCheckout(), reading: found(checks) })

      expect(source(THREAD)).toBeUndefined()
    },
  )

  it('never holds a thread open without a pull request', () => {
    expect(sourceFor({ checkout: aCheckout(), reading: WAS_ABSENT })(THREAD)).toBeUndefined()
  })

  it('never holds a thread open that stands on no checkout', () => {
    expect(
      sourceFor({ checkout: null, reading: found(EChecksState.Running) })(THREAD),
    ).toBeUndefined()
  })
})
