import { describe, expect, it } from 'bun:test'

import { ECallStatus, EExecOutcome, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import type { RemoteCalls } from '../../calls/remote-calls'
import { WorkspaceGate } from '../../calls/workspace-gate'
import { worktreesOf } from '../checkouts'
import type { PrepareResult } from '../ports'

const wake = (): { promise: Promise<PrepareResult>; settle(result: PrepareResult): void } => {
  let settle: (result: PrepareResult) => void = () => {}
  const promise = new Promise<PrepareResult>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const gateOf = (attempt: Promise<PrepareResult>): WorkspaceGate => {
  const gate = new WorkspaceGate()
  gate.arm(attempt)
  return gate
}

const callsOf = (): { calls: RemoteCalls; ops: CallOp[] } => {
  const ops: CallOp[] = []
  const calls = {
    invoke: async (args: { op: CallOp }): Promise<CallResult> => {
      ops.push(args.op)
      return {
        status: ECallStatus.Ok,
        op: 'exec',
        value: { outcome: EExecOutcome.Exited, exitCode: 1, signal: null, outputBytes: 0 },
      }
    },
  } as unknown as RemoteCalls
  return { calls, ops }
}

const paused = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, 20))

describe('the worktree port of a workspace that is waking', () => {
  it('runs no git command until the workspace has prepared', async () => {
    const pending = wake()
    const { calls, ops } = callsOf()
    const worktrees = worktreesOf({ calls, gate: gateOf(pending.promise) })

    const listing = worktrees.list({ cwd: '/work' })
    await paused()
    expect(ops).toHaveLength(0)

    pending.settle({ ok: true })
    await expect(listing).rejects.toThrow('is not inside a git repository')
    expect(ops.length).toBeGreaterThan(0)
  })

  it('fails with the reason the wake failed, without reaching the pod', async () => {
    const { calls, ops } = callsOf()
    const worktrees = worktreesOf({
      calls,
      gate: gateOf(Promise.resolve({ ok: false, reason: 'the sandbox did not wake' })),
    })

    await expect(worktrees.create({ cwd: '/work', name: 'dennis/wt' })).rejects.toThrow(
      'the workspace failed to prepare: the sandbox did not wake',
    )
    expect(ops).toHaveLength(0)
  })

  it('reaches the pod at once when the runtime carries no gate', async () => {
    const { calls, ops } = callsOf()
    const worktrees = worktreesOf({ calls })

    await expect(worktrees.list({ cwd: '/work' })).rejects.toThrow('is not inside a git repository')
    expect(ops.length).toBeGreaterThan(0)
  })
})
