import { describe, expect, it } from 'bun:test'

import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { DaemonProcessPort } from '../..'

const FOREGROUND = { timeoutMs: 1_500, shellId: 'shell-foreground' }

const PENDING: CallResult = {
  status: ECallStatus.Failed,
  op: 'exec',
  error: { code: ECallFailure.Internal, message: 'still running' },
}

const spawned = (args: { capabilities: readonly string[]; ops: CallOp[] }) =>
  new DaemonProcessPort({
    calls: {
      invoke: (request) => {
        args.ops.push(request.op)
        return Promise.resolve(PENDING)
      },
    },
    capabilities: () => args.capabilities,
  }).spawn({ cmd: ['bash', '-c', 'true'], cwd: '/', foreground: FOREGROUND })

describe('a host that gives the foreground deadline to the daemon', () => {
  it('sends the deadline and the shell id with the exec, and keeps no timer', () => {
    const ops: CallOp[] = []
    const handle = spawned({ capabilities: ['exec.deadline'], ops })

    expect(handle.foregroundDeadlineOwned).toBe(true)
    expect(ops[0]).toEqual({
      op: 'exec',
      argv: ['bash', '-c', 'true'],
      cwd: '/',
      deadlineMs: FOREGROUND.timeoutMs,
      shellId: FOREGROUND.shellId,
    })
  })

  it('keeps its own timer, and sends no deadline, to a daemon that does not declare it', () => {
    const ops: CallOp[] = []
    const handle = spawned({ capabilities: [], ops })

    expect(handle.foregroundDeadlineOwned).toBe(false)
    expect(ops[0]).toEqual({ op: 'exec', argv: ['bash', '-c', 'true'], cwd: '/' })
  })
})
