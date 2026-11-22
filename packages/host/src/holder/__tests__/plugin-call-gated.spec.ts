import { describe, expect, it } from 'bun:test'
import { CallInterruptedError } from '@dltech/atlas-core'
import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'

import type { PrepareResult } from '../ports'
import { WorkspaceGate } from '../../calls/workspace-gate'
import { pluginCallOf } from '../plugin-call'

const EXEC: CallOp = { op: 'exec', argv: ['/bin/sh', '-c', 'echo hi'] }

const gate = (): { promise: Promise<PrepareResult>; settle(result: PrepareResult): void } => {
  let settle: (result: PrepareResult) => void = () => {}
  const promise = new Promise<PrepareResult>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const rig = (attempt: Promise<PrepareResult>) => {
  const workspace = new WorkspaceGate()
  workspace.arm(attempt)
  const invocations: CallOp[] = []
  const call = pluginCallOf({
    gate: workspace,
    invoke: async (args): Promise<CallResult> => {
      invocations.push(args.op)
      if (args.op.op !== 'exec') throw new Error('the spec only runs exec calls')
      return {
        status: ECallStatus.Ok,
        op: 'exec',
        value: { outcome: EExecOutcome.Exited, exitCode: 0, signal: null, outputBytes: 0 },
      }
    },
  })
  return { call, invocations }
}

describe('a plugin call that needs the pod', () => {
  it('runs once the workspace has prepared', async () => {
    const { call, invocations } = rig(Promise.resolve({ ok: true }))
    expect((await call(EXEC)).status).toBe(ECallStatus.Ok)
    expect(invocations).toHaveLength(1)
  })

  it('waits for the wake and then runs', async () => {
    const pending = gate()
    const { call, invocations } = rig(pending.promise)
    const running = call(EXEC)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(invocations).toHaveLength(0)

    pending.settle({ ok: true })
    expect((await running).status).toBe(ECallStatus.Ok)
    expect(invocations).toHaveLength(1)
  })

  it('fails the call with the reason the wake failed, without reaching the pod', async () => {
    const { call, invocations } = rig(Promise.resolve({ ok: false, reason: 'sandbox asleep' }))
    expect(await call(EXEC)).toMatchObject({
      status: ECallStatus.Failed,
      error: {
        code: ECallFailure.Internal,
        message: 'the workspace failed to prepare: sandbox asleep',
      },
    })
    expect(invocations).toHaveLength(0)
  })

  it('throws an interruption when the turn aborts while it waits', async () => {
    const { call, invocations } = rig(new Promise<PrepareResult>(() => {}))
    const controller = new AbortController()
    const running = call(EXEC, { signal: controller.signal })
    controller.abort()
    await expect(running).rejects.toBeInstanceOf(CallInterruptedError)
    expect(invocations).toHaveLength(0)
  })
})
