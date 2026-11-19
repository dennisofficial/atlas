import { describe, expect, it } from 'bun:test'

import { followingCommandsOf, followingOf } from '../details/following'
import { pullRequestFixture, subscriptionFixture } from './fixture'

const secondPr = {
  ...pullRequestFixture,
  number: 9,
  url: 'https://github.com/owner/atlas/pull/9',
  title: 'Map the pane',
}

describe('followingOf', () => {
  it('is on when every linked pull request is subscribed', () => {
    expect(
      followingOf({ entries: [pullRequestFixture], subscriptions: [subscriptionFixture] }),
    ).toBe(true)
  })

  it('is off when a link has no subscription', () => {
    expect(
      followingOf({
        entries: [pullRequestFixture, secondPr],
        subscriptions: [subscriptionFixture],
      }),
    ).toBe(false)
  })

  it('is off when the session has no pull requests', () => {
    expect(followingOf({ entries: [], subscriptions: [subscriptionFixture] })).toBe(false)
  })
})

describe('followingCommandsOf', () => {
  it('subscribes the links that are not followed yet', () => {
    expect(
      followingCommandsOf({
        entries: [pullRequestFixture, secondPr],
        subscriptions: [subscriptionFixture],
        following: true,
      }),
    ).toEqual([
      { name: 'subscribe', args: { provider: 'github.pull-request', target: 'owner/atlas#9' } },
    ])
  })

  it('is a no-op when every link is already followed', () => {
    expect(
      followingCommandsOf({
        entries: [pullRequestFixture],
        subscriptions: [subscriptionFixture],
        following: true,
      }),
    ).toEqual([])
  })

  it('unsubscribes the session’s own pull requests when following turns off', () => {
    expect(
      followingCommandsOf({
        entries: [pullRequestFixture],
        subscriptions: [subscriptionFixture],
        following: false,
      }),
    ).toEqual([{ name: 'unsubscribe', args: { subscriptionId: 'sub_7' } }])
  })

  it('leaves subscriptions for pull requests this session does not link', () => {
    expect(
      followingCommandsOf({
        entries: [secondPr],
        subscriptions: [subscriptionFixture],
        following: false,
      }),
    ).toEqual([])
  })
})
