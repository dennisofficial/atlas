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
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'

import { subscribeCommand, unsubscribeCommand } from '../../core'
import { githubPod, CI_WATCH_DENY_REASON } from '..'
import { PULL_REQUEST_SUBSCRIBE_REASON } from '../ci-watch-hook'

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
      calls.push(argv)
      const answer = answers[argv]
      if (answer === undefined) return exec('', 1)(options?.onOutput)
      return answer(options?.onOutput)
    },
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx, log, calls }
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
  it('subscribes to the current branch pull request and appends one created event', async () => {
    const { ctx, log } = rig({ [PR_VIEW]: exec('https://github.com/Dltech/Atlas/pull/7') })
    const outcome = await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request' },
    })
    expect(outcome.ok).toBe(true)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      type: 'subscription-created',
      provider: 'github.pull-request',
      label: 'dltech/atlas#7',
      target: { repo: 'github.com/dltech/atlas', number: 7 },
      createdBy: ESubscriptionActor.Agent,
    })
  })

  it('returns the existing subscription instead of a second one', async () => {
    const { ctx, log } = rig({})
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: 'o/r#2' },
    })
    const again = await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: 'https://github.com/o/r/pull/2' },
    })
    expect(again.ok && again.modelText).toContain('Already subscribed')
    expect(log).toHaveLength(1)
  })

  it('resolves a bare number through the checkout repository', async () => {
    const { ctx, log } = rig({
      'gh repo view --json nameWithOwner -q .nameWithOwner': exec('o/r'),
    })
    await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: '#5' },
    })
    expect(log[0]).toMatchObject({ target: { repo: 'github.com/o/r', number: 5 } })
  })

  it('refuses with the reason when no pull request is found, appending nothing', async () => {
    const { ctx, log } = rig({})
    const outcome = await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request' },
    })
    expect(outcome).toMatchObject({ ok: false })
    expect(log).toHaveLength(0)
  })

  it('refuses another provider', async () => {
    const { ctx } = rig({})
    expect(await invoke({ ctx, name: 'subscribe', input: { provider: 'slack' } })).toMatchObject({
      ok: false,
    })
  })

  it('unsubscribes by id, refuses an unknown id, and lists what is held', async () => {
    const { ctx, log } = rig({})
    const made = await invoke({
      ctx,
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: 'o/r#2' },
    })
    const id = made.ok ? (made.output as { subscriptionId: string }).subscriptionId : ''
    const listed = await invoke({ ctx, name: 'list_subscriptions', input: {} })
    expect(listed.ok && listed.modelText).toContain('o/r#2')
    expect(
      await invoke({ ctx, name: 'unsubscribe', input: { subscriptionId: 'nope' } }),
    ).toMatchObject({ ok: false })
    expect(await invoke({ ctx, name: 'unsubscribe', input: { subscriptionId: id } })).toMatchObject(
      { ok: true },
    )
    expect(log.at(-1)).toMatchObject({
      type: 'subscription-ended',
      subscriptionId: id,
      reason: 'unsubscribed',
    })
    const after = await invoke({ ctx, name: 'list_subscriptions', input: {} })
    expect(after.ok && after.modelText).toContain('no subscriptions')
  })

  it('declares a read effect for the list tool', () => {
    const { ctx } = rig({})
    const tools = githubPod.tools?.(ctx) ?? []
    expect(tools.map((t) => [t.name, t.effect])).toContainEqual([
      'list_subscriptions',
      EToolEffect.Read,
    ])
  })
})

describe('github pod commands', () => {
  const run = async (args: { kind: string; input: unknown; rigged?: ReturnType<typeof rig> }) => {
    const r = args.rigged ?? rig({})
    const handler = githubPod.commands.get(args.kind)
    if (handler === undefined) throw new Error('missing handler')
    const result = await handler({
      args: args.input,
      sessionId: 's1',
      inboxId: 1,
      visibleEvents: () => [],
      append: r.ctx.append,
      log: () => undefined,
    })
    return { result, r }
  }

  it('subscribe command with an explicit target appends as the operator', async () => {
    const { result, r } = await run({
      kind: subscribeCommand.inboxKind,
      input: { provider: 'github.pull-request', target: 'o/r#3' },
    })
    expect(result).toEqual({ kind: 'done' })
    expect(r.log[0]).toMatchObject({ createdBy: ESubscriptionActor.Operator })
  })

  it('subscribe command without a target is refused rather than guessing a checkout', async () => {
    const { result, r } = await run({
      kind: subscribeCommand.inboxKind,
      input: { provider: 'github.pull-request' },
    })
    expect(result.kind).toBe('refused')
    expect(r.log).toHaveLength(0)
  })

  it('unsubscribe command refuses an unknown id', async () => {
    const { result } = await run({
      kind: unsubscribeCommand.inboxKind,
      input: { subscriptionId: 'x' },
    })
    expect(result.kind).toBe('refused')
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
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: 'o/r#2' },
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
      name: 'subscribe',
      input: { provider: 'github.pull-request', target: 'o/r#2' },
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
