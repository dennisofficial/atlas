import { describe, expect, it } from 'bun:test'
import { SubscriptionTargetError, resolvedSubscriptionTargetOf } from './subscription-target'

const REPO = 'github.com/acme/atlas'

describe('resolvedSubscriptionTargetOf', () => {
  it('reads the owner/repo#number shorthand and a pull request URL', () => {
    expect(
      resolvedSubscriptionTargetOf({ provider: 'github.pull-request', target: 'acme/atlas#7' }),
    ).toEqual({
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      lease: { repo: REPO, subject: { kind: 'pull-request', number: 7 } },
    })
    expect(
      resolvedSubscriptionTargetOf({
        provider: 'github.pull-request',
        target: 'https://github.com/acme/atlas/pull/9',
      }).target,
    ).toEqual({ repo: REPO, number: 9 })
  })

  it('reads a workflow run reference into the run target and its selector', () => {
    expect(
      resolvedSubscriptionTargetOf({ provider: 'github.workflow-run', target: 'acme/atlas#12' }),
    ).toEqual({
      target: { kind: 'run', repo: REPO, runId: 12 },
      label: 'acme/atlas#12',
      lease: { repo: REPO, subject: { kind: 'workflow-run', selector: '#run:12' } },
    })
  })

  it.each([
    { provider: 'github.pull-request', target: '#7' },
    { provider: 'github.pull-request', target: 'acme/atlas' },
    { provider: 'github.workflow-run', target: 'acme/atlas' },
    { provider: 'github.workflow-run', target: 'ci.yml@main' },
    { provider: 'gitlab.merge-request', target: 'acme/atlas#7' },
  ])('refuses $provider $target', (args) => {
    expect(() => resolvedSubscriptionTargetOf(args)).toThrow(SubscriptionTargetError)
  })
})
