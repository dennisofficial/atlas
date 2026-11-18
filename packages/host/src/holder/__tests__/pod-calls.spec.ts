import { describe, expect, it, mock } from 'bun:test'

import { ELiveOpFailure, type CallOp } from '@dltech/atlas-protocol'

import { PodCalls } from '../pod-calls'
import type { SessionRuntime } from '../ports'

const OP: CallOp = { op: 'stat', path: 'a.ts' }

const runtimeOf = (invoke: (args: { op: CallOp; signal?: AbortSignal }) => Promise<unknown>) =>
  ({
    remoteCalls: {
      invoke: (args: { op: CallOp; signal?: AbortSignal }) => invoke(args),
      onEvent: () => () => undefined,
    },
  }) as unknown as SessionRuntime

describe('PodCalls', () => {
  it('answers asleep without dialling when no holder exists', async () => {
    const calls = new PodCalls({ held: () => undefined })
    expect(await calls.invoke({ sessionId: 'ses', op: OP })).toEqual({
      state: 'unavailable',
      reason: ELiveOpFailure.Asleep,
    })
  })

  it('forwards the op verbatim and returns the pod result', async () => {
    const invoke = mock(async () => ({
      status: 'ok',
      op: 'stat',
      value: { size: 1, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
    }))
    const calls = new PodCalls({ held: () => runtimeOf(invoke) })
    const outcome = await calls.invoke({ sessionId: 'ses', op: OP })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect((invoke.mock.calls[0] as unknown as [{ op: CallOp }])[0].op).toEqual(OP)
    expect(outcome.state).toBe('ok')
  })

  it('surfaces a timeout with the op name', async () => {
    const calls = new PodCalls({
      held: () => runtimeOf(() => new Promise(() => undefined)),
      timeoutMs: 5,
    })
    await expect(calls.invoke({ sessionId: 'ses', op: OP })).rejects.toThrow('stat timed out')
  })

  it('rejects when the caller aborts', async () => {
    const calls = new PodCalls({
      held: () =>
        runtimeOf(
          (args) =>
            new Promise((_, reject) => {
              args.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            }),
        ),
    })
    const controller = new AbortController()
    const pending = calls.invoke({ sessionId: 'ses', op: OP, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
  })
})
