import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  ESubscriptionActor,
  toCallId,
  toThreadId,
  EToolEffect,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type V2Event,
} from '@dltech/atlas-core'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import {
  EMPTY_CREW,
  EMPTY_CLASSIFIER,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  EMPTY_POD_RESOURCES,
  EMPTY_MESSAGES,
} from '@dltech/atlas-plugin-sdk'

import { githubPod, CI_WATCH_DENY_REASON } from '..'
import { PULL_REQUEST_SUBSCRIBE_REASON } from '../ci-watch-hook'
import { EXPIRES, fakeSubscriptions } from './support'

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
  const calls: string[] = []
  const subscriptions = fakeSubscriptions()
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
    control: { ...podControlStub, subscriptions: subscriptions.port },
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    messages: EMPTY_MESSAGES,
    classifier: EMPTY_CLASSIFIER,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    notify: async () => undefined,
    sessionId: 's1',
    append,
    events: () => log,
    call: async (op: CallOp, options) => {
      const argv = op.op === 'exec' ? op.argv.join(' ') : ''
      calls.push(argv)
      const answer = answers[argv]
      if (answer === undefined) return exec('', 1)(options?.onOutput)
      return answer(options?.onOutput)
    },
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx, log, calls, subscriptions }
}

const invoke = async (args: { ctx: PluginPodContext; name: string; input: unknown }) => {
  const tool = githubPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

const PR_VIEW = 'gh pr view --json url -q .url'

describe('github pod tools', () => {
  it('subscribes to the current branch pull request through the control plane', async () => {
    const { ctx, log, subscriptions } = rig({
      [PR_VIEW]: exec('https://github.com/Dltech/Atlas/pull/7'),
    })
    const outcome = await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request' },
    })
    expect(outcome.ok).toBe(true)
    expect(log).toHaveLength(0)
    expect([...subscriptions.rows.values()]).toMatchObject([
      {
        provider: 'github.pull-request',
        label: 'dltech/atlas#7',
        target: { repo: 'github.com/dltech/atlas', number: 7 },
      },
    ])
    expect(subscriptions.leases).toEqual([
      { repo: 'github.com/dltech/atlas', subject: { kind: 'pull-request', number: 7 } },
    ])
    expect(outcome.ok ? outcome.modelText : '').toContain(
      `Subscribed to dltech/atlas#7 (id sub-1, expires ${EXPIRES}).`,
    )
  })

  it('returns the existing subscription instead of a second one', async () => {
    const { ctx, subscriptions } = rig({})
    const first = await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: 'o/r#2' },
    })
    const again = await invoke({
      ctx,
      name: 'subscription',
      input: {
        action: 'subscribe',
        provider: 'github.pull-request',
        target: 'https://github.com/o/r/pull/2',
      },
    })
    expect(first.ok && (first.output as { subscriptionId: string }).subscriptionId).toBe('sub-1')
    expect(again.ok && again.modelText).toContain('Already subscribed to o/r#2')
    expect(subscriptions.rows.size).toBe(1)
  })

  it('resolves a bare number through the checkout repository', async () => {
    const { ctx, subscriptions } = rig({
      'gh repo view --json nameWithOwner -q .nameWithOwner': exec('o/r'),
    })
    await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: '#5' },
    })
    expect([...subscriptions.rows.values()][0]).toMatchObject({
      target: { repo: 'github.com/o/r', number: 5 },
    })
  })

  it('refuses with the reason when no pull request is found, subscribing to nothing', async () => {
    const { ctx, subscriptions } = rig({})
    const outcome = await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request' },
    })
    expect(outcome).toMatchObject({ ok: false })
    expect(subscriptions.rows.size).toBe(0)
  })

  it('refuses another provider', async () => {
    const { ctx } = rig({})
    expect(
      await invoke({
        ctx,
        name: 'subscription',
        input: { action: 'subscribe', provider: 'slack' },
      }),
    ).toMatchObject({
      ok: false,
    })
  })

  it('unsubscribes by id, refuses an unknown id, and lists what is held', async () => {
    const { ctx, subscriptions } = rig({})
    const made = await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: 'o/r#2' },
    })
    const id = made.ok ? (made.output as { subscriptionId: string }).subscriptionId : ''
    const listed = await invoke({ ctx, name: 'subscription', input: { action: 'list' } })
    expect(listed.ok && listed.modelText).toContain('o/r#2')
    expect(
      await invoke({
        ctx,
        name: 'subscription',
        input: { action: 'unsubscribe', subscriptionId: 'nope' },
      }),
    ).toMatchObject({
      ok: false,
      reason: `This session has no subscription "nope". subscription with action list shows the ones it has.`,
    })
    expect(
      await invoke({
        ctx,
        name: 'subscription',
        input: { action: 'unsubscribe', subscriptionId: id },
      }),
    ).toMatchObject({ ok: true })
    expect(subscriptions.calls).toContain(`unsubscribe:${id}`)
    const after = await invoke({ ctx, name: 'subscription', input: { action: 'list' } })
    expect(after.ok && after.modelText).toContain('no subscriptions')
  })

  it('subscribes to a filtered set of occurrences and labels the filter', async () => {
    const { ctx, subscriptions } = rig({})
    const outcome = await invoke({
      ctx,
      name: 'subscription',
      input: {
        action: 'subscribe',
        provider: 'github.pull-request',
        target: 'o/r#4',
        events: ['state', 'ci'],
      },
    })
    expect(outcome.ok && outcome.modelText).toContain('o/r#4 (only: ci, state)')
    expect([...subscriptions.rows.values()][0]).toMatchObject({
      label: 'o/r#4 (only: ci, state)',
      events: ['ci', 'state'],
    })
  })

  it('refuses an unknown event, naming the valid ones and subscribing to nothing', async () => {
    const { ctx, subscriptions } = rig({})
    const outcome = await invoke({
      ctx,
      name: 'subscription',
      input: {
        action: 'subscribe',
        provider: 'github.pull-request',
        target: 'o/r#4',
        events: ['ci', 'nope'],
      },
    })
    expect(outcome.ok ? '' : outcome.reason).toContain(
      'Valid events: ci, comments, mergeability, state',
    )
    expect(subscriptions.rows.size).toBe(0)
  })

  it('replaces the filter on re-subscribe with the same id, and the list shows it', async () => {
    const { ctx, subscriptions } = rig({})
    const made = await invoke({
      ctx,
      name: 'subscription',
      input: {
        action: 'subscribe',
        provider: 'github.pull-request',
        target: 'o/r#4',
        events: ['ci'],
      },
    })
    const id = made.ok ? (made.output as { subscriptionId: string }).subscriptionId : ''
    const again = await invoke({
      ctx,
      name: 'subscription',
      input: {
        action: 'subscribe',
        provider: 'github.pull-request',
        target: 'o/r#4',
        events: ['state'],
      },
    })
    expect(again.ok && again.modelText).toContain('Updated o/r#4 (only: state)')
    expect(again.ok && (again.output as { subscriptionId: string }).subscriptionId).toBe(id)
    expect(again.ok && (again.output as { existed: boolean }).existed).toBe(true)
    expect([...subscriptions.rows.values()][0]).toMatchObject({
      id,
      label: 'o/r#4 (only: state)',
      events: ['state'],
    })
    const listed = await invoke({ ctx, name: 'subscription', input: { action: 'list' } })
    expect(listed.ok && listed.modelText).toContain('o/r#4 (only: state)')
  })

  it('keeps the held filter when re-subscribing without events', async () => {
    const { ctx, subscriptions } = rig({})
    await invoke({
      ctx,
      name: 'subscription',
      input: {
        action: 'subscribe',
        provider: 'github.pull-request',
        target: 'o/r#4',
        events: ['state'],
      },
    })
    const again = await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: 'o/r#4' },
    })
    expect(again.ok && again.modelText).toContain('Already subscribed to')
    expect([...subscriptions.rows.values()][0]).toMatchObject({ events: ['state'] })
  })

  it('refuses an events filter on a provider that has no filter', async () => {
    const { ctx } = rig({})
    expect(
      await invoke({
        ctx,
        name: 'subscription',
        input: {
          action: 'subscribe',
          provider: 'github.workflow-run',
          target: '#run:1',
          events: ['ci'],
        },
      }),
    ).toMatchObject({
      ok: false,
      reason: 'github.workflow-run has no event filter; it delivers every occurrence.',
    })
  })

  it('declares one write tool, with only list safe to run beside another call', () => {
    const { ctx } = rig({})
    const tools = githubPod.tools?.(ctx) ?? []
    expect(tools.map((t) => [t.name, t.effect])).toEqual([['subscription', EToolEffect.Write]])
    const tool = tools[0]
    expect(tool?.isConcurrencySafe?.({ action: 'list' })).toBe(true)
    expect(tool?.isConcurrencySafe?.({ action: 'subscribe' })).toBe(false)
  })

  it('names the action and the field it is missing', async () => {
    const { ctx } = rig({})
    const noProvider = await invoke({ ctx, name: 'subscription', input: { action: 'subscribe' } })
    expect(noProvider.ok ? '' : noProvider.reason).toContain('✖ action subscribe needs provider')
    const noId = await invoke({ ctx, name: 'subscription', input: { action: 'unsubscribe' } })
    expect(noId.ok ? '' : noId.reason).toContain('✖ action unsubscribe needs subscriptionId')
  })

  it('declares no pod commands', () => {
    expect(githubPod.commands.size).toBe(0)
  })
})

describe('github ci watch hook', () => {
  const callOf = (command: string) => ({
    callId: toCallId('c1'),
    name: 'bash',
    input: { command },
    effect: EToolEffect.Destructive,
    threadId: toThreadId('t1'),
  })
  const consult = async (args: { rigged: ReturnType<typeof rig>; command: string }) => {
    const hook = githubPod.hooks?.(args.rigged.ctx).beforeTool?.[0]
    if (hook === undefined) throw new Error('no hook')
    return hook.run({
      call: callOf(args.command),
      projectDirectory: '/work',
      events: [],
      signal: new AbortController().signal,
    })
  }

  it('denies a watch on the subscribed pull request', async () => {
    const rigged = rig({ [PR_VIEW]: exec('https://github.com/o/r/pull/2') })
    await invoke({
      ctx: rigged.ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: 'o/r#2' },
    })
    expect(await consult({ rigged, command: 'gh pr checks --watch' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: CI_WATCH_DENY_REASON,
    })
  })

  it('allows a one-shot read and denies a watch no subscription covers', async () => {
    const rigged = rig({ [PR_VIEW]: exec('https://github.com/o/r/pull/9') })
    await invoke({
      ctx: rigged.ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: 'o/r#2' },
    })
    expect((await consult({ rigged, command: 'gh pr checks' })).decision).toBe(
      EBeforeToolDecision.Allow,
    )
    expect(await consult({ rigged, command: 'gh pr checks --watch' })).toEqual({
      decision: EBeforeToolDecision.Deny,
      reason: PULL_REQUEST_SUBSCRIBE_REASON,
    })
  })
})

describe('github subscription rows', () => {
  it('writes the actor the control plane settled on, not the tool', async () => {
    const { ctx, subscriptions } = rig({})
    await invoke({
      ctx,
      name: 'subscription',
      input: { action: 'subscribe', provider: 'github.pull-request', target: 'o/r#3' },
    })
    expect([...subscriptions.rows.values()][0]?.createdBy).toBe(ESubscriptionActor.Agent)
  })
})
