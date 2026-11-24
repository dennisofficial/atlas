import { describe, expect, it } from 'bun:test'

import { CallInterruptedError, EProcessOutcome } from '@dltech/atlas-core'
import {
  ECallFailure,
  ECallStatus,
  EExecOutcome,
  type CallOp,
  type CallResult,
  type ExecResult,
} from '@dltech/atlas-protocol'

import { DaemonProcessPort } from '../..'

const BACKGROUNDED_RESULT: ExecResult = {
  exitCode: null,
  signal: null,
  outcome: EExecOutcome.Backgrounded,
  outputBytes: 12,
  shellId: 'shell-1a2b3c4d',
}

const BACKGROUNDED: CallResult = {
  status: ECallStatus.Ok,
  op: 'exec',
  value: BACKGROUNDED_RESULT,
}

const RESIZE_MESSAGE =
  'This call was interrupted because the pod is being resized to 8 vCPU / 32 GB. Try again now: the next call waits until the resize finishes.'

const INTERRUPTED: CallResult = {
  status: ECallStatus.Failed,
  op: 'exec',
  error: { code: ECallFailure.Interrupted, message: RESIZE_MESSAGE },
}

const adopted = (value: boolean): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec.background',
  value: { adopted: value },
})

const spawned = (invoke: (args: { key: string; op: CallOp }) => Promise<CallResult>) =>
  new DaemonProcessPort({ calls: { invoke } }).spawn({ cmd: ['bash', '-c', 'true'], cwd: '/' })

describe('a daemon that hands the exec over', () => {
  it('reports the handover as its own outcome rather than a failure', async () => {
    const handle = spawned(() => Promise.resolve(BACKGROUNDED))

    expect(await handle.outcome).toEqual({
      kind: EProcessOutcome.Backgrounded,
      shellId: 'shell-1a2b3c4d',
    })
  })

  it('answers exited with the temporary-failure code, because the command itself did not exit', async () => {
    const handle = spawned(() => Promise.resolve(BACKGROUNDED))

    expect(await handle.exited).toBe(75)
  })

  it('asks the daemon to adopt the running exec under the key it was spawned with', async () => {
    const ops: { key: string; op: CallOp }[] = []
    const handle = spawned((args) => {
      ops.push(args)
      return Promise.resolve(args.op.op === 'exec' ? BACKGROUNDED : adopted(true))
    })
    const move = handle.moveToBackground
    if (move === undefined) throw new Error('the daemon handle cannot be handed over')

    expect(await move({ shellId: 'shell-1a2b3c4d' })).toBe(true)
    const spawn = ops[0]
    const adoption = ops[1]
    if (spawn === undefined || adoption === undefined) throw new Error('both ops were not invoked')
    expect(adoption.op).toEqual({
      op: 'exec.background',
      execKey: spawn.key,
      shellId: 'shell-1a2b3c4d',
    })
    expect(adoption.key).not.toBe(spawn.key)
  })

  it('answers false when the exec was already gone, so the caller kills it as before', async () => {
    const handle = spawned(() => Promise.resolve(adopted(false)))
    const move = handle.moveToBackground
    if (move === undefined) throw new Error('the daemon handle cannot be handed over')

    expect(await move({ shellId: 'shell-1a2b3c4d' })).toBe(false)
  })

  it('answers false when the daemon has no such op, as an older one does not', async () => {
    const handle = spawned(() =>
      Promise.resolve<CallResult>({
        status: ECallStatus.Failed,
        op: 'exec.background',
        error: { code: ECallFailure.NotFound, message: 'unknown op exec.background' },
      }),
    )
    const move = handle.moveToBackground
    if (move === undefined) throw new Error('the daemon handle cannot be handed over')

    expect(await move({ shellId: 'shell-1a2b3c4d' })).toBe(false)
  })

  it('answers false when the transport fails during the handover', async () => {
    const handle = spawned((args) =>
      args.op.op === 'exec'
        ? Promise.reject(new Error('socket closed'))
        : Promise.reject(new Error('gone')),
    )
    const move = handle.moveToBackground
    if (move === undefined) throw new Error('the daemon handle cannot be handed over')

    expect(await move({ shellId: 'shell-1a2b3c4d' })).toBe(false)
  })
})

describe('a daemon that interrupted the exec to resize the pod', () => {
  it('keeps the reason the host gave in the outcome', async () => {
    const handle = spawned(() => Promise.resolve(INTERRUPTED))

    expect(await handle.outcome).toEqual({
      kind: EProcessOutcome.Interrupted,
      message: RESIZE_MESSAGE,
    })
  })

  it('hands that reason on as the model message of the interruption', async () => {
    const handle = spawned(() => Promise.resolve(INTERRUPTED))

    const thrown = await handle.exited.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(thrown).toBeInstanceOf(CallInterruptedError)
    expect((thrown as CallInterruptedError).modelMessage).toBe(RESIZE_MESSAGE)
  })
})
