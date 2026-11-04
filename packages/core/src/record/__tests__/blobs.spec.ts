import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../events/ids'
import {
  BLOB_PREVIEW_BYTES,
  blobRefsOf,
  isBlobRef,
  resolveBody,
  spillBody,
  type BlobRef,
} from '../blobs'
import { chainEvents } from '../chain-events'
import { v2EventSchema, type V2Body } from '../event'

const toolResult = (output: unknown): V2Body => ({
  type: 'tool-result',
  callId: 'call-1',
  name: 'bash',
  output,
})

const thresholdBytes = 256

describe('spillBody', () => {
  it('leaves a body below the threshold untouched', () => {
    const body = toolResult({ text: 'small' })
    const result = spillBody({ body, thresholdBytes })
    expect(result.body).toBe(body)
    expect(result.blobs).toEqual([])
  })

  it('leaves non-spillable bodies untouched', () => {
    const body: V2Body = { type: 'user-said', text: 'x'.repeat(10_000) }
    const result = spillBody({ body, thresholdBytes })
    expect(result.body).toBe(body)
    expect(result.blobs).toEqual([])
  })

  it('spills an oversized tool-result output into a content-addressed blob', () => {
    const output = { text: 'y'.repeat(10_000) }
    const result = spillBody({ body: toolResult(output), thresholdBytes })
    expect(result.blobs.length).toBe(1)
    const blob = result.blobs[0]
    expect(blob).toBeDefined()
    if (result.body.type !== 'tool-result') throw new Error('type drifted')
    const ref = result.body.output
    expect(isBlobRef(ref)).toBe(true)
    if (!isBlobRef(ref)) throw new Error('unreachable')
    expect(ref.$blob.hash).toBe(blob?.hash)
    expect(ref.$blob.size).toBe(blob?.bytes.byteLength)
    expect(new TextEncoder().encode(ref.$blob.preview).byteLength).toBeLessThanOrEqual(
      BLOB_PREVIEW_BYTES,
    )
  })

  it('spills tool-called input and fact-recorded value', () => {
    const called: V2Body = {
      type: 'tool-called',
      callId: 'c1',
      name: 'bash',
      input: { big: 'z'.repeat(1000) },
      ordinal: 0,
    }
    const fact: V2Body = { type: 'fact-recorded', key: 'k', kind: 'note', value: 'v'.repeat(1000) }
    expect(blobRefsOf(spillBody({ body: called, thresholdBytes }).body)).toEqual([
      expect.objectContaining({ field: 'input' }),
    ])
    expect(blobRefsOf(spillBody({ body: fact, thresholdBytes }).body)).toEqual([
      expect.objectContaining({ field: 'value' }),
    ])
  })

  it('hashes the canonical JSON, so key order does not matter', () => {
    const left = spillBody({
      body: toolResult({ a: 'p'.repeat(500), b: 2 }),
      thresholdBytes,
    })
    const right = spillBody({
      body: toolResult({ b: 2, a: 'p'.repeat(500) }),
      thresholdBytes,
    })
    expect(left.blobs[0]?.hash).toBe(right.blobs[0]?.hash)
  })

  it('cuts the preview on a code point', () => {
    const output = 'é'.repeat(BLOB_PREVIEW_BYTES)
    const result = spillBody({ body: toolResult(output), thresholdBytes: 100 })
    const ref = blobRefsOf(result.body)[0]
    expect(ref).toBeDefined()
    if (result.body.type !== 'tool-result' || !isBlobRef(result.body.output)) {
      throw new Error('unreachable')
    }
    const preview = result.body.output.$blob.preview
    expect(new TextEncoder().encode(preview).byteLength).toBeLessThanOrEqual(BLOB_PREVIEW_BYTES)
    expect(JSON.stringify(output).startsWith(preview)).toBe(true)
    expect(ref?.size).toBeGreaterThan(BLOB_PREVIEW_BYTES)
  })

  it('keeps the reference form valid through v2EventSchema', () => {
    const spilled = spillBody({ body: toolResult('q'.repeat(1000)), thresholdBytes })
    const [event] = chainEvents({
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      epoch: 1,
      bodies: [spilled.body],
      at: '2026-11-04T00:00:00.000Z',
    })
    const parsed = v2EventSchema.safeParse(event)
    expect(parsed.success).toBe(true)
  })
})

describe('resolveBody', () => {
  it('round-trips a spilled body back to the original', () => {
    const output = { text: 'r'.repeat(5000), nested: [1, 2, { ok: true }] }
    const body = toolResult(output)
    const spilled = spillBody({ body, thresholdBytes })
    const values = new Map<string, unknown>([[spilled.blobs[0]?.hash ?? '', output]])
    expect(resolveBody({ body: spilled.body, values })).toEqual(body)
  })

  it('returns the same body when nothing references a blob', () => {
    const body = toolResult({ text: 'small' })
    expect(resolveBody({ body, values: new Map() })).toBe(body)
  })

  it('throws when the referenced value is missing', () => {
    const spilled = spillBody({ body: toolResult('s'.repeat(1000)), thresholdBytes })
    expect(() => resolveBody({ body: spilled.body, values: new Map() })).toThrow(
      `missing blob value for ${spilled.blobs[0]?.hash ?? ''}`,
    )
  })
})

describe('isBlobRef', () => {
  it('accepts only the reference shape', () => {
    const ref: BlobRef = {
      $blob: { hash: 'a'.repeat(64), size: 3, preview: 'abc' },
    }
    expect(isBlobRef(ref)).toBe(true)
    expect(isBlobRef({ $blob: { hash: 'nope', size: 3, preview: 'abc' } })).toBe(false)
    expect(isBlobRef({ $blob: 'x' })).toBe(false)
    expect(isBlobRef('x')).toBe(false)
    expect(isBlobRef(undefined)).toBe(false)
  })
})
