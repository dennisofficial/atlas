import { describe, expect, it } from 'bun:test'

import {
  CallInterruptedError,
  EProcessOutcome,
  type ProcessHandle,
  type ProcessOutcome,
} from '@dltech/atlas-core'

import { readShell } from '../shell-process'

const RESIZE_MESSAGE =
  'This call was interrupted because the pod is being resized to 8 vCPU / 32 GB. Try again now: the next call waits until the resize finishes.'

const empty = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (sink) => sink.close(),
  })

const shellOf = (outcome: ProcessOutcome): ProcessHandle => ({
  stdout: empty(),
  stderr: empty(),
  exited: Promise.resolve(137),
  outcome: Promise.resolve(outcome),
  terminate: () => undefined,
})

describe('reading a shell the host interrupted', () => {
  it('carries the reason the host gave into the model message', async () => {
    const reading = readShell({
      shell: shellOf({ kind: EProcessOutcome.Interrupted, message: RESIZE_MESSAGE }),
      limit: 1_000,
    })

    const thrown = await reading.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(thrown).toBeInstanceOf(CallInterruptedError)
    expect((thrown as CallInterruptedError).modelMessage).toBe(RESIZE_MESSAGE)
  })
})
