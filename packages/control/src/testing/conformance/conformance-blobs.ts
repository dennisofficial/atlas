import { beforeEach, describe, expect, it } from 'bun:test'
import { spillBody, type V2Body } from '@dltech/atlas-core'

import type { ConformanceParams } from './conformance'
import { makeHarness, mint, seedGranted, THREAD, type Harness } from './support'

const bigOutput = { text: 'blob-'.repeat(5_000) }

const spill = () =>
  spillBody({
    body: { type: 'tool-result', callId: 'call-1', name: 'bash', output: bigOutput },
    thresholdBytes: 64,
  })

export function describeControlPlaneBlobs(params: ConformanceParams): void {
  describe(`ControlPlane blobs (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    it('commits the blob with the append and reads it back', async () => {
      const { body, blobs } = spill()
      const blob = blobs[0]
      if (blob === undefined) throw new Error('expected a spill')
      const events = mint({ bodies: [body as V2Body], epoch })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events, blobs })
      expect(outcome.ok).toBe(true)
      const read = await harness.plane.readBlob({ hash: blob.hash })
      expect(read?.size).toBe(blob.bytes.byteLength)
      expect(read?.bytes).toEqual(blob.bytes)
    })

    it('serves ranged reads against the stored bytes', async () => {
      const { body, blobs } = spill()
      const blob = blobs[0]
      if (blob === undefined) throw new Error('expected a spill')
      const events = mint({ bodies: [body as V2Body], epoch })
      await harness.plane.append({ threadId: THREAD, epoch, events, blobs })
      const read = await harness.plane.readBlob({ hash: blob.hash, offset: 7, length: 11 })
      expect(read?.size).toBe(blob.bytes.byteLength)
      expect(read?.bytes).toEqual(blob.bytes.subarray(7, 18))
      const tail = await harness.plane.readBlob({ hash: blob.hash, offset: blob.bytes.byteLength })
      expect(tail?.bytes.byteLength).toBe(0)
    })

    it('accepts a second append that carries the same blob', async () => {
      const { body, blobs } = spill()
      const first = mint({ bodies: [body as V2Body], epoch })
      const won = await harness.plane.append({ threadId: THREAD, epoch, events: first, blobs })
      expect(won.ok).toBe(true)
      if (!won.ok) throw new Error('unreachable')
      const second = mint({ bodies: [body as V2Body], epoch, from: won.head })
      const outcome = await harness.plane.append({
        threadId: THREAD,
        epoch,
        events: second,
        blobs,
      })
      expect(outcome.ok).toBe(true)
    })

    it('refuses a tampered blob and commits nothing', async () => {
      const { body, blobs } = spill()
      const blob = blobs[0]
      if (blob === undefined) throw new Error('expected a spill')
      const events = mint({ bodies: [body as V2Body], epoch })
      const tampered = [{ hash: blob.hash, bytes: new Uint8Array([1, 2, 3, 4]) }]
      const outcome = await harness.plane.append({
        threadId: THREAD,
        epoch,
        events,
        blobs: tampered,
      })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'blob-mismatch' } })
      expect((await harness.plane.head({ threadId: THREAD })).seq).toBe(0)
      expect(await harness.plane.readBlob({ hash: blob.hash })).toBeUndefined()
    })
  })
}
