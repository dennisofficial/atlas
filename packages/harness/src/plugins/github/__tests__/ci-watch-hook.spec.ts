import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EToolEffect,
  toCallId,
  toThreadId,
  type BeforeToolOutcome,
  type ToolCall,
} from '@dltech/atlas-core'

import {
  BlockCiWatchBeforeToolHook,
  CI_WATCH_DENY_REASON,
  PULL_REQUEST_SUBSCRIBE_REASON,
  WORKFLOW_RUN_SUBSCRIBE_REASON,
  WORKFLOW_RUN_WAKE_REASON,
} from '../ci-watch-hook'
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

const SUBSCRIBED_REPO = 'github.com/dennisofficial/atlas'
const MAIN_RUN = `${SUBSCRIBED_REPO}@dennis/main`

type RunArgs = {
  service?: PullRequestService
  input: unknown
  name?: string
  directory?: string
  subscribedTo?: readonly number[]
  subscribedRuns?: readonly string[]
}

const ranWith = async (args: RunArgs): Promise<BeforeToolOutcome> =>
  new BlockCiWatchBeforeToolHook({
    pullRequests: args.service ?? trackingFound(),
    subscribed: ({ repo, number }) =>
      repo === SUBSCRIBED_REPO && (args.subscribedTo ?? [42, 9]).includes(number),
    subscribedRun: ({ repo, branch }) =>
      (args.subscribedRuns ?? [MAIN_RUN]).includes(`${repo}@${branch}`),
    probe: async ({ directory }) => PROBES[directory] ?? null,
  }).run({
    call: callOf({ input: args.input, ...(args.name === undefined ? {} : { name: args.name }) }),
    projectDirectory: args.directory ?? '/work/atlas',
    events: [],
    signal: NEVER_ABORTED,
  })

const denialReason = async (args: RunArgs): Promise<string | null> => {
  const outcome = await ranWith(args)
  return outcome.decision === EBeforeToolDecision.Deny ? outcome.reason : null
}

const mustDeny = async (args: RunArgs): Promise<string> => {
  const reason = await denialReason(args)
  if (reason === null) throw new Error('expected the hook to deny')

  return reason
}

describe('the hook that refuses to watch CI', () => {
  it('denies a pull request watch under the existing reason when the PR is subscribed', async () => {
    const outcome = await ranWith({
      input: { command: 'gh pr checks --watch' },
      subscribedTo: [42],
    })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Deny, reason: CI_WATCH_DENY_REASON })
  })

  it('carries the pull request reason verbatim', () => {
    expect(CI_WATCH_DENY_REASON).toBe(
      "Atlas is delivering this PR's events to you through a subscription and will wake you when CI reaches a verdict, a comment lands, or it merges. Do not poll or watch. Read once with `gh pr checks` (no --watch) for current state, or end your turn.",
    )
  })

  it('denies a pull request watch with the subscribe reason when the PR is not subscribed', async () => {
    const reason = await mustDeny({ input: { command: 'gh pr checks --watch' }, subscribedTo: [] })

    expect(reason).toBe(
      "Atlas delivers pull request events through a subscription: call `subscribe` with provider `github.pull-request` (blank for this checkout's pull request), then end your turn. One-shot reads such as `gh pr checks` stay available.",
    )
    expect(PULL_REQUEST_SUBSCRIBE_REASON).toBe(
      "Atlas delivers pull request events through a subscription: call `subscribe` with provider `github.pull-request` (blank for this checkout's pull request), then end your turn. One-shot reads such as `gh pr checks` stay available.",
    )
  })

  it('denies a run watch with the wake reason when the run is already subscribed', async () => {
    const outcome = await ranWith({ input: { command: 'gh run watch 123' } })

    expect(outcome).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_WAKE_REASON,
    })
  })

  it('carries the wake reason verbatim', () => {
    expect(WORKFLOW_RUN_WAKE_REASON).toBe(
      'Atlas is already delivering this workflow run to you and will wake you when it finishes. End your turn; read once with `gh run view <id>` (no `--watch`) if you need the current state now.',
    )
  })

  it('denies a run watch with the subscribe reason when no run is subscribed', async () => {
    const reason = await mustDeny({
      input: { command: 'gh run view 123 --watch' },
      subscribedRuns: [],
    })

    expect(reason).toBe(
      "Do not watch runs from bash: call `subscribe` with provider `github.workflow-run` (blank for this push's run, or `<workflow>@<branch>`), then end your turn. One-shot reads such as `gh run view <id>` stay available.",
    )
    expect(WORKFLOW_RUN_SUBSCRIBE_REASON).toBe(
      "Do not watch runs from bash: call `subscribe` with provider `github.workflow-run` (blank for this push's run, or `<workflow>@<branch>`), then end your turn. One-shot reads such as `gh run view <id>` stay available.",
    )
  })

  it('never denies without a reason, so a denial is always teachable', async () => {
    for (const command of [
      'gh pr checks --watch',
      'gh run watch 123',
      'while true; do gh run list; sleep 20; done',
      'gh api repos/o/r/actions/runs/9; sleep 10',
    ]) {
      expect(await denialReason({ input: { command } })).toBeTruthy()
    }
  })
})

describe('the watch the hook classified', () => {
  it('answers a pull request watch with the pull request reason', async () => {
    expect(await mustDeny({ input: { command: 'watch gh pr checks' } })).toBe(CI_WATCH_DENY_REASON)
    expect(
      await mustDeny({ input: { command: 'while true; do gh pr checks; sleep 30; done' } }),
    ).toBe(CI_WATCH_DENY_REASON)
  })

  it('answers a run watch with the workflow run reason', async () => {
    for (const command of [
      'gh run view 123 --watch',
      'gh run view 123 -w',
      'watch -n 10 gh run view 123',
      'git push && gh run watch 123',
      'while true; do gh api repos/o/r/actions/runs?per_page=1; sleep 5; done',
      'while true; do gh run list; sleep 20; done',
      'gh api repos/o/r/actions/runs/9 && sleep 10',
    ]) {
      expect(await mustDeny({ input: { command } })).toBe(WORKFLOW_RUN_WAKE_REASON)
    }
  })
})

describe('what the hook allows', () => {
  it('allows the one-shot reads and hands the input through untouched', async () => {
    for (const command of [
      'gh run view 123',
      'gh run list',
      'gh pr checks',
      'gh pr view 1 --json statusCheckRollup',
    ]) {
      const input = { command }

      expect(await ranWith({ input })).toEqual({
        decision: EBeforeToolDecision.Allow,
        input,
      })
    }
  })

  it('allows a watch from a tool that is not bash', async () => {
    const outcome = await ranWith({
      name: 'write_file',
      input: { command: 'gh run watch 123' },
    })

    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
  })

  it('allows an input that carries no command', async () => {
    for (const input of [{}, null, { command: 42 }, 'gh run watch 123']) {
      expect((await ranWith({ input })).decision).toBe(EBeforeToolDecision.Allow)
    }
  })

  it('allows a watch from a directory that is no checkout', async () => {
    const outcome = await ranWith({
      input: { command: 'gh run watch 123' },
      directory: '/tmp/nowhere',
    })

    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
  })
})

describe('the checkout a watch is judged against', () => {
  it('reads the pull request of its own checkout, not any tracked one', async () => {
    const service = serviceTracking([
      { checkout: MAIN, reading: wasFound() },
      { checkout: TEAMMATE, reading: wasFound({ number: 7 }) },
    ])
    const input = { command: 'gh pr checks --watch' }

    expect(await denialReason({ service, input, directory: '/work/atlas' })).toBe(
      CI_WATCH_DENY_REASON,
    )
    expect(await denialReason({ service, input, directory: '/work/teammate' })).toBe(
      PULL_REQUEST_SUBSCRIBE_REASON,
    )
  })

  it('treats an untracked or unread pull request as not subscribed', async () => {
    for (const reading of [WAS_ABSENT, wasUnavailable(true)]) {
      const service = serviceTracking([{ checkout: MAIN, reading }])

      expect(await denialReason({ service, input: { command: 'gh pr checks --watch' } })).toBe(
        PULL_REQUEST_SUBSCRIBE_REASON,
      )
    }

    const empty = serviceTracking([])

    expect(await denialReason({ service: empty, input: { command: 'gh pr checks --watch' } })).toBe(
      PULL_REQUEST_SUBSCRIBE_REASON,
    )
  })

  it('asks about the branch its own checkout is on', async () => {
    const service = serviceTracking([
      { checkout: MAIN, reading: WAS_ABSENT },
      { checkout: TEAMMATE, reading: WAS_ABSENT },
    ])

    expect(
      await denialReason({
        service,
        input: { command: 'gh run watch 123' },
        directory: '/work/teammate',
        subscribedRuns: [],
      }),
    ).toBe(WORKFLOW_RUN_SUBSCRIBE_REASON)

    expect(
      await denialReason({
        service,
        input: { command: 'gh run watch 123' },
        directory: '/work/teammate',
        subscribedRuns: [`${SUBSCRIBED_REPO}@dennis/teammate`],
      }),
    ).toBe(WORKFLOW_RUN_WAKE_REASON)
  })
})
