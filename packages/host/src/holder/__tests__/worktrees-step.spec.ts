import { expect, it } from 'bun:test'

import { ECrashedCall } from '@dltech/atlas-agent'
import {
  EToolEffect,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { EMPTY_CREW, type PodWorktrees } from '@dltech/atlas-plugin-sdk'

import { runInCallScope } from '../../calls/call-scope'
import { crashSettleOf } from '../crash-settle'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'
import { RecordBookkeeping } from '../record/record-bookkeeping'

const THREAD = toThreadId('t1')
const PATH = '/work/.atlas/worktrees/topic'
const REMOVE_ARGV = `git worktree remove ${PATH}`
const SCOPE = { scopeKey: 'call-1', callId: 'call-1' }

type Answer = { stdout?: string; code?: number }

const recordOf = () => {
  const book = new RecordBookkeeping()
  const appended: EventDraft[] = []
  const record = {
    eventCache: () => ({ bookkeeping: () => book }),
    append: async (args: { drafts: readonly EventDraft[] }) => {
      for (const draft of args.drafts) {
        appended.push(draft)
        book.step({
          ...(draft as RecordEventBody),
          id: `e${appended.length}`,
          seq: appended.length,
          threadId: THREAD,
          at: '2026-11-26T10:00:00.000Z',
        } as RecordEvent)
      }
    },
  } as unknown as SessionRecord
  return { record, appended }
}

const rig = (answers: Record<string, Answer>) => {
  const { record, appended } = recordOf()
  const calls: string[] = []
  const runtime = {
    launchDirectory: '/work',
    daemonTools: new Set<string>(),
    effectOf: () => EToolEffect.Destructive,
    remoteCalls: {
      invoke: async (call: {
        op: { op?: string; argv?: readonly string[] }
        onOutput?: (bytes: Uint8Array) => void
      }) => {
        if (call.op.op !== 'exec') return { status: 'ok', value: undefined }
        const argv = (call.op.argv ?? []).join(' ')
        calls.push(argv)
        const answer = answers[argv] ?? { code: 1 }
        if (answer.stdout !== undefined) {
          call.onOutput?.(new TextEncoder().encode(answer.stdout))
        }
        return {
          status: 'ok',
          key: 'k',
          op: 'exec',
          value: { exitCode: answer.code ?? 0, outcome: 'exited' },
        }
      },
    },
  } as unknown as SessionRuntime
  const deps = {
    sessionId: 's1',
    ids: { nextRunId: () => toRunId('r1') },
  } as unknown as HeldSessionDeps
  const ctx = pluginPodContextOf({
    deps,
    runtime,
    record,
    threadId: THREAD,
    signal: new AbortController().signal,
    crew: EMPTY_CREW,
  })
  return { ctx, runtime, record, calls, appended }
}

const removed = (worktrees: PodWorktrees) =>
  runInCallScope({
    ...SCOPE,
    body: () => worktrees.remove({ cwd: '/work', path: PATH, branch: 'topic', force: false }),
  })

const crashOf = (args: { runtime: SessionRuntime; record: SessionRecord; name?: string }) => {
  const call = {
    callId: toCallId('call-1'),
    runId: toRunId('r1'),
    threadId: THREAD,
    name: args.name ?? 'exit_worktree',
    input: { action: 'remove' },
    ordinal: 0,
  }
  return crashSettleOf({ runtime: args.runtime, record: args.record, call })
}

const answersOfRemoval = (): Record<string, Answer> => ({
  'git rev-parse --abbrev-ref HEAD': { stdout: 'topic\n' },
  [REMOVE_ARGV]: { code: 0 },
  'git branch -D topic': { code: 0 },
})

it('records the remove step before it acts, so a crash after the remove holds', async () => {
  const { ctx, runtime, record, calls } = rig(answersOfRemoval())

  const result = await removed(ctx.worktrees)

  expect(result).toEqual({ branch: 'topic', branchDeleted: true })
  expect(calls).toContain(REMOVE_ARGV)
  expect(crashOf({ runtime, record })).toBe(ECrashedCall.Hold)
})

it('removes without recording a step when there is no call scope', async () => {
  const { ctx, appended } = rig(answersOfRemoval())

  const result = await ctx.worktrees.remove({
    cwd: '/work',
    path: PATH,
    branch: 'topic',
    force: false,
  })

  expect(result).toEqual({ branch: 'topic', branchDeleted: true })
  expect(appended).toHaveLength(0)
})

it('records the create step before it acts, so a crash after the create holds', async () => {
  const { ctx, runtime, record, calls } = rig({
    'git worktree list --porcelain': {
      stdout: [
        'worktree /work',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
      ].join('\n'),
    },
    'git fetch origin': { code: 1 },
    'git symbolic-ref --quiet --short refs/remotes/origin/HEAD': { stdout: 'origin/main\n' },
    'git worktree add /work/.atlas/worktrees/topic -b topic origin/main': { code: 0 },
  })

  const entry = await runInCallScope({
    ...SCOPE,
    body: () => ctx.worktrees.create({ cwd: '/work', name: 'topic' }),
  })

  expect(entry).toEqual({ path: PATH, branch: 'topic', base: 'origin/main', staleBase: true })
  expect(calls).toContain('git worktree add /work/.atlas/worktrees/topic -b topic origin/main')
  expect(crashOf({ runtime, record, name: 'enter_worktree' })).toBe(ECrashedCall.Hold)
})

it('replays a held remove without removing twice and still reports the branch deleted', async () => {
  const answers = answersOfRemoval()
  const { ctx, runtime, record, appended } = rig(answers)
  await removed(ctx.worktrees)
  expect(crashOf({ runtime, record })).toBe(ECrashedCall.Hold)

  Object.assign(answers, {
    'git rev-parse --abbrev-ref HEAD': { code: 1 },
    [REMOVE_ARGV]: { code: 128 },
    'git worktree list --porcelain': {
      stdout: [
        'worktree /work',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
      ].join('\n'),
    },
    'git rev-parse --verify --quiet refs/heads/topic': { stdout: 'abc123\n' },
    'git branch -D topic': { code: 0 },
  })

  const replay = await removed(ctx.worktrees)

  expect(replay).toEqual({ branch: 'topic', branchDeleted: true })
  expect(appended).toHaveLength(1)
})
