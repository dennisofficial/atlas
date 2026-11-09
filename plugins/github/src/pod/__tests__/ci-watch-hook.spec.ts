import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  ESubscriptionActor,
  EToolEffect,
  toCallId,
  toThreadId,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type V2Event,
} from '@dltech/atlas-core'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'

import type { PullRequestTarget, RunTarget } from '../../core'
import { githubPod } from '..'
import {
  CI_WATCH_DENY_REASON,
  PULL_REQUEST_SUBSCRIBE_REASON,
  WORKFLOW_RUN_SUBSCRIBE_REASON,
  WORKFLOW_RUN_WAKE_REASON,
} from '../ci-watch-hook'

type Drafts = readonly (EventDraft | RecordBody | PluginEventBody)[]

const exec =
  (text: string, exitCode = 0) =>
  (onOutput?: (b: Uint8Array) => void): CallResult => {
    onOutput?.(new TextEncoder().encode(text))
    return {
      status: ECallStatus.Ok,
      op: 'exec',
      value: { exitCode, signal: null, outcome: 'exited', outputBytes: text.length },
    } as CallResult
  }

const rig = (answers: Record<string, ReturnType<typeof exec>>) => {
  const log: V2Event[] = []
  const append = async (drafts: Drafts): Promise<void> => {
    for (const body of drafts) {
      log.push({
        ...body,
        seq: log.length + 1,
        threadId: toThreadId('t1'),
        at: '2026-11-08T10:00:00.000Z',
      } as V2Event)
    }
  }
  const ctx: PluginPodContext = {
    control: podControlStub,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    sessionId: 's1',
    append,
    events: () => log,
    call: async (op: CallOp, options) => {
      const argv = op.op === 'exec' ? op.argv.join(' ') : ''
      const answer = answers[argv]
      if (answer === undefined) return exec('', 1)(options?.onOutput)
      return answer(options?.onOutput)
    },
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx, log }
}

const NAME = 'gh repo view --json nameWithOwner -q .nameWithOwner'
const HEAD = 'gh pr view --json headRefName -q .headRefName'
const PR_VIEW = 'gh pr view --json url -q .url'
const CHECKOUT = { [NAME]: exec('o/r'), [HEAD]: exec('main') }

const consult = async (args: { rigged: ReturnType<typeof rig>; command: string }) => {
  const hook = githubPod.hooks?.(args.rigged.ctx).beforeTool?.[0]
  if (hook === undefined) throw new Error('no hook')
  return hook.run({
    call: {
      callId: toCallId('c1'),
      name: 'bash',
      input: { command: args.command },
      effect: EToolEffect.Destructive,
      threadId: toThreadId('t1'),
    },
    projectDirectory: '/work',
    events: [],
    signal: new AbortController().signal,
  })
}

const hold = async (args: {
  rigged: ReturnType<typeof rig>
  provider: string
  target: PullRequestTarget | RunTarget
}) => {
  await args.rigged.ctx.append([
    {
      type: 'subscription-created',
      subscriptionId: 's1',
      provider: args.provider,
      target: args.target,
      label: 'held',
      createdBy: ESubscriptionActor.Agent,
    },
  ])
}

const selector = (branch: string): RunTarget => ({
  kind: 'selector',
  repo: 'github.com/o/r',
  workflow: 'deploy.yml',
  branch,
})

describe('github ci watch hook on workflow runs', () => {
  it('denies a run watch the checkout already delivers', async () => {
    const rigged = rig(CHECKOUT)
    await hold({ rigged, provider: 'github.workflow-run', target: selector('main') })
    expect(await consult({ rigged, command: 'gh run watch 12' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_WAKE_REASON,
    })
    expect(await consult({ rigged, command: 'gh run view 12 --watch' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_WAKE_REASON,
    })
  })

  it('denies a run watch on a held pinned run in the checkout repository', async () => {
    const rigged = rig(CHECKOUT)
    await hold({
      rigged,
      provider: 'github.workflow-run',
      target: { kind: 'run', repo: 'github.com/o/r', runId: 5 },
    })
    expect(await consult({ rigged, command: 'gh run watch 12' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_WAKE_REASON,
    })
  })

  it('tells the agent to subscribe when the run is on another branch or another repository', async () => {
    const otherBranch = rig(CHECKOUT)
    await hold({ rigged: otherBranch, provider: 'github.workflow-run', target: selector('dev') })
    expect(await consult({ rigged: otherBranch, command: 'gh run watch 12' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_SUBSCRIBE_REASON,
    })

    const otherRepo = rig(CHECKOUT)
    await hold({
      rigged: otherRepo,
      provider: 'github.workflow-run',
      target: { kind: 'run', repo: 'github.com/x/y', runId: 5 },
    })
    expect(await consult({ rigged: otherRepo, command: 'gh run watch 12' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_SUBSCRIBE_REASON,
    })
  })

  it('denies with the subscribe reason when the checkout repository cannot be read', async () => {
    const rigged = rig({})
    await hold({ rigged, provider: 'github.workflow-run', target: selector('main') })
    expect(await consult({ rigged, command: 'gh run watch 12' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: WORKFLOW_RUN_SUBSCRIBE_REASON,
    })
  })

  it('allows a one-shot run read and leaves another tool alone', async () => {
    const rigged = rig(CHECKOUT)
    await hold({ rigged, provider: 'github.workflow-run', target: selector('main') })
    expect((await consult({ rigged, command: 'gh run view 12' })).decision).toBe(
      EBeforeToolDecision.Allow,
    )
    expect((await consult({ rigged, command: 'gh run list' })).decision).toBe(
      EBeforeToolDecision.Allow,
    )
  })
})

describe('github ci watch hook on pull requests', () => {
  it('denies a watch no subscription covers with the subscribe reason', async () => {
    const rigged = rig({ [PR_VIEW]: exec('https://github.com/o/r/pull/2') })
    expect(await consult({ rigged, command: 'gh pr checks --watch' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: PULL_REQUEST_SUBSCRIBE_REASON,
    })
  })

  it('denies a watch on a subscribed pull request', async () => {
    const rigged = rig({ [PR_VIEW]: exec('https://github.com/o/r/pull/2') })
    await hold({
      rigged,
      provider: 'github.pull-request',
      target: { repo: 'github.com/o/r', number: 2 },
    })
    expect(await consult({ rigged, command: 'gh pr checks --watch' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: CI_WATCH_DENY_REASON,
    })
  })
})
