import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EToolEffect,
  toCallId,
  toThreadId,
  type BeforeToolOutcome,
  type ToolCall,
} from '@dltech/atlas-core'

import { BlockCiWatchBeforeToolHook, CI_WATCH_DENY_REASON } from '../ci-watch-hook'
import type { PullRequestReading, RepositoryCheckout } from '../pure'
import type { PullRequestService } from '../pull-request-service'
import { aCheckout, WAS_ABSENT, wasFound, wasUnavailable } from '../testing'

const NEVER_ABORTED = new AbortController().signal

const callOf = (args: { name?: string; input: unknown }): ToolCall => ({
  callId: toCallId('call-1'),
  name: args.name ?? 'bash',
  input: args.input,
  effect: EToolEffect.Destructive,
  threadId: toThreadId('thread-fixture'),
})

const serviceTracking = (
  tracked: { checkout: RepositoryCheckout; reading: PullRequestReading } | null,
): PullRequestService => ({
  snapshot: () => {
    throw new Error('unused')
  },
  version: () => 0,
  subscribe: () => () => undefined,
  ingest: () => undefined,
  track: () => undefined,
  stopTracking: () => undefined,
  watch: () => undefined,
  current: () => tracked,
  states: () => [],
  expectChecks: () => undefined,
  recheck: () => undefined,
  refresh: async () => undefined,
  dispose: () => undefined,
})

const trackingFound = (): PullRequestService =>
  serviceTracking({ checkout: aCheckout(), reading: wasFound() })

const ranWith = async (args: {
  service: PullRequestService
  input: unknown
  name?: string
}): Promise<BeforeToolOutcome> =>
  new BlockCiWatchBeforeToolHook({ pullRequests: args.service }).run({
    call: callOf({ input: args.input, ...(args.name === undefined ? {} : { name: args.name }) }),
    projectDirectory: '/work/atlas',
    events: [],
    signal: NEVER_ABORTED,
  })

const denies = (outcome: BeforeToolOutcome): boolean =>
  outcome.decision === EBeforeToolDecision.Deny

describe('the hook that refuses to watch CI', () => {
  it('denies a watching command when the checkout has a tracked pull request', async () => {
    const outcome = await ranWith({
      service: trackingFound(),
      input: { command: 'gh run watch 123' },
    })

    expect(outcome).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: CI_WATCH_DENY_REASON,
    })
  })

  it('carries the teaching reason verbatim', () => {
    expect(CI_WATCH_DENY_REASON).toBe(
      'Atlas tracks this PR natively and will wake you when CI reaches a verdict, a comment lands, or mergeability changes. Do not poll or watch. Read once with `gh pr checks` (no --watch) if you need current state; otherwise continue other work or end your turn.',
    )
  })

  it('denies every watching spelling', async () => {
    for (const command of [
      'gh pr checks --watch',
      'watch -n 10 gh run view 123',
      'while true; do gh pr checks; sleep 30; done',
      'git push && gh run watch 123',
    ]) {
      expect(denies(await ranWith({ service: trackingFound(), input: { command } }))).toBe(true)
    }
  })

  it('denies a backgrounded-style command, which is still a bash call', async () => {
    const outcome = await ranWith({
      service: trackingFound(),
      input: { command: 'gh run watch 123 &' },
    })

    expect(denies(outcome)).toBe(true)
  })

  it('allows a one-shot read and hands the input through untouched', async () => {
    const input = { command: 'gh pr checks' }
    const outcome = await ranWith({ service: trackingFound(), input })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input })
  })

  it('allows a watch when no checkout is tracked', async () => {
    const outcome = await ranWith({
      service: serviceTracking(null),
      input: { command: 'gh run watch 123' },
    })

    expect(denies(outcome)).toBe(false)
  })

  it('allows a watch when the tracked checkout has no pull request', async () => {
    for (const reading of [WAS_ABSENT, wasUnavailable(true)]) {
      const outcome = await ranWith({
        service: serviceTracking({ checkout: aCheckout(), reading }),
        input: { command: 'gh run watch 123' },
      })

      expect(denies(outcome)).toBe(false)
    }
  })

  it('allows a watch from a tool that is not bash', async () => {
    const outcome = await ranWith({
      service: trackingFound(),
      name: 'write_file',
      input: { command: 'gh run watch 123' },
    })

    expect(denies(outcome)).toBe(false)
  })

  it('allows an input that carries no command', async () => {
    for (const input of [{}, null, { command: 42 }, 'gh run watch 123']) {
      expect(denies(await ranWith({ service: trackingFound(), input }))).toBe(false)
    }
  })
})
