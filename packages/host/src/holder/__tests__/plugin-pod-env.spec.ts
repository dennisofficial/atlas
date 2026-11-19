import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import { EMPTY_CREW } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, EExecOutcome, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

const execResult = (): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 0 },
})

const contextOf = (env?: () => Promise<Record<string, string>>) => {
  const seen: CallOp[] = []
  const deps = {
    sessionId: 'session-1',
    ids: { nextRunId: () => toRunId('run-1') },
    bus: {},
  } as unknown as HeldSessionDeps
  const runtime = {
    launchDirectory: '/work',
    env,
    remoteCalls: {
      invoke: async (call: { op: CallOp }): Promise<CallResult> => {
        seen.push(call.op)
        return execResult()
      },
      onEvent: () => () => undefined,
    },
  } as unknown as SessionRuntime
  const record = {} as unknown as SessionRecord
  const ctx = pluginPodContextOf({
    deps,
    runtime,
    record,
    threadId: toThreadId('thread-1'),
    signal: new AbortController().signal,
    crew: EMPTY_CREW,
  })
  return { ctx, seen }
}

const shellEnv = async (): Promise<Record<string, string>> => ({
  GH_TOKEN: 'ghs_session',
  GIT_CONFIG_COUNT: '1',
})

describe('pluginPodContextOf call', () => {
  it('gives an exec call the same shell env that agent bash gets', async () => {
    const { ctx, seen } = contextOf(shellEnv)
    await ctx.call({ op: 'exec', argv: ['gh', 'repo', 'view'], cwd: '/work/.atlas/worktrees/wt' })

    expect(seen).toEqual([
      {
        op: 'exec',
        argv: ['gh', 'repo', 'view'],
        cwd: '/work/.atlas/worktrees/wt',
        env: { GH_TOKEN: 'ghs_session', GIT_CONFIG_COUNT: '1' },
      },
    ])
  })

  it('keeps an env the call sets itself above the session env', async () => {
    const { ctx, seen } = contextOf(shellEnv)
    await ctx.call({ op: 'exec', argv: ['gh'], env: { GH_TOKEN: 'ghs_own' } })

    expect(seen[0]).toEqual({
      op: 'exec',
      argv: ['gh'],
      env: { GH_TOKEN: 'ghs_own', GIT_CONFIG_COUNT: '1' },
    })
  })

  it('leaves an op that is not an exec without an env', async () => {
    const { ctx, seen } = contextOf(shellEnv)
    await ctx.call({ op: 'readFile', path: '/work/README.md' })

    expect(seen).toEqual([{ op: 'readFile', path: '/work/README.md' }])
  })
})
