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
import { checkoutKey, type PullRequestReading, type RepositoryCheckout } from '../pure'
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
  tracked: { checkout: RepositoryCheckout; reading: PullRequestReading }[],
): PullRequestService => ({
  snapshot: ({ key }) =>
    tracked.find((entry) => checkoutKey(entry.checkout) === key)?.reading ?? WAS_ABSENT,
  version: () => 0,
  subscribe: () => () => undefined,
  ingest: () => undefined,
  track: () => undefined,
  setVisible: () => undefined,
  tracked: () => tracked.map((entry) => entry.checkout),
  watch: () => undefined,
  current: () => tracked[0] ?? null,
  states: () => [],
  expectChecks: () => undefined,
  recheck: () => undefined,
  refresh: async () => undefined,
  dispose: () => undefined,
})

const MAIN = aCheckout({ directory: '/work/atlas', branch: 'dennis/main' })
const TEAMMATE = aCheckout({ directory: '/work/teammate', branch: 'dennis/teammate' })

const trackingFound = (): PullRequestService =>
  serviceTracking([{ checkout: MAIN, reading: wasFound() }])

const PROBES: Readonly<Record<string, RepositoryCheckout>> = {
  '/work/atlas': MAIN,
  '/work/teammate': TEAMMATE,
}

const ranWith = async (args: {
  service: PullRequestService
  input: unknown
  name?: string
  directory?: string
}): Promise<BeforeToolOutcome> =>
  new BlockCiWatchBeforeToolHook({
    pullRequests: args.service,
    probe: async ({ directory }) => PROBES[directory] ?? null,
  }).run({
    call: callOf({ input: args.input, ...(args.name === undefined ? {} : { name: args.name }) }),
    projectDirectory: args.directory ?? '/work/atlas',
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
      service: serviceTracking([]),
      input: { command: 'gh run watch 123' },
    })

    expect(denies(outcome)).toBe(false)
  })

  it('allows a watch when the tracked checkout has no pull request', async () => {
    for (const reading of [WAS_ABSENT, wasUnavailable(true)]) {
      const outcome = await ranWith({
        service: serviceTracking([{ checkout: MAIN, reading }]),
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

  it('gates a teammate on its own checkout’s pull request, not the main thread’s', async () => {
    const service = serviceTracking([
      { checkout: MAIN, reading: wasFound() },
      { checkout: TEAMMATE, reading: WAS_ABSENT },
    ])
    const input = { command: 'gh run watch 123' }

    expect(denies(await ranWith({ service, input, directory: '/work/atlas' }))).toBe(true)
    expect(denies(await ranWith({ service, input, directory: '/work/teammate' }))).toBe(false)
  })

  it('denies a teammate whose own checkout has a pull request while the main thread has none', async () => {
    const service = serviceTracking([
      { checkout: MAIN, reading: WAS_ABSENT },
      { checkout: TEAMMATE, reading: wasFound({ number: 9 }) },
    ])

    const outcome = await ranWith({
      service,
      input: { command: 'gh run watch 123' },
      directory: '/work/teammate',
    })

    expect(denies(outcome)).toBe(true)
  })

  it('allows a watch from a directory that is no checkout', async () => {
    const outcome = await ranWith({
      service: trackingFound(),
      input: { command: 'gh run watch 123' },
      directory: '/tmp/nowhere',
    })

    expect(denies(outcome)).toBe(false)
  })
})
