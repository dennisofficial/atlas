import { describe, expect, it } from 'bun:test'

import { CallOutput, OUTPUT_FRAME_BYTES, type CallSink } from '../call-output'
import { ECallJournalState, MemoryCallStore } from '../call-store'

type OutputFrame = { offset: number; bytes: Uint8Array }

const pattern = (length: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) bytes[index] = index % 251
  return bytes
}

const expectContiguous = (args: {
  frames: readonly OutputFrame[]
  bytes: Uint8Array<ArrayBuffer>
}): void => {
  expect(args.frames.length).toBeGreaterThan(1)
  let expectedOffset = 0
  const parts: Uint8Array[] = []
  for (const frame of args.frames) {
    expect(frame.bytes.length).toBeLessThanOrEqual(OUTPUT_FRAME_BYTES)
    expect(frame.offset).toBe(expectedOffset)
    expectedOffset += frame.bytes.length
    parts.push(frame.bytes)
  }
  expect(expectedOffset).toBe(args.bytes.length)
  const joined = new Uint8Array(args.bytes.length)
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.length
  }
  expect(joined).toEqual(args.bytes)
}

const rig = (): {
  output: CallOutput
  store: MemoryCallStore
  frames: OutputFrame[]
  faults: unknown[]
} => {
  const store = new MemoryCallStore()
  const frames: OutputFrame[] = []
  const faults: unknown[] = []
  const output = new CallOutput({
    key: 'k-split',
    op: 'stat',
    store,
    onFault: ({ error }) => faults.push(error),
  })
  return { output, store, frames, faults }
}

const sink = (frames: OutputFrame[]): CallSink => ({
  output: (frame) => frames.push({ offset: frame.offset, bytes: new Uint8Array(frame.bytes) }),
  result: () => {},
})

const journal = {
  state: ECallJournalState.Running,
  epoch: 1,
  op: { op: 'stat', path: '/' },
  outputBytes: 0,
} as const

describe('CallOutput frame splitting', () => {
  it('splits a live append larger than 64 KB into contiguous frames', async () => {
    const { output, store, frames, faults } = rig()
    await store.writeState({ key: 'k-split', journal })
    output.attach({ owner: {}, sink: sink(frames), fromOffset: 0 })
    await output.drain()
    const bytes = pattern(OUTPUT_FRAME_BYTES * 2 + 100)
    output.write(bytes)
    await output.drain()
    expect(faults).toEqual([])
    expectContiguous({ frames, bytes })
  })

  it('splits a replay larger than 64 KB into contiguous frames', async () => {
    const { output, store, frames, faults } = rig()
    await store.writeState({ key: 'k-split', journal })
    const bytes = pattern(OUTPUT_FRAME_BYTES * 3 + 1)
    output.write(bytes)
    await output.drain()
    expect(frames).toEqual([])
    output.attach({ owner: {}, sink: sink(frames), fromOffset: 0 })
    await output.drain()
    expect(faults).toEqual([])
    expectContiguous({ frames, bytes })
  })
})
