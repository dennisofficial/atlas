import { beforeEach, describe, expect, it } from 'bun:test'
import { spillBody, toCallId, type V2Body } from '@dltech/atlas-core'

import type { ConformanceParams } from './conformance'
import {
  createSessionParams,
  makeHarness,
  mint,
  seedGranted,
  SESSION,
  THREAD,
  type Harness,
} from './support'

const spill = (text: string) =>
  spillBody({
    body: { type: 'tool-result', callId: toCallId('call-1'), name: 'bash', output: { text } },
    thresholdBytes: 64,
  })

const spillOnce = () => spill('blob-'.repeat(5_000))

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
      const { body, blobs } = spillOnce()
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
      const { body, blobs } = spillOnce()
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
      const { body, blobs } = spillOnce()
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

    it('refuses an event that references a blob nobody supplied or stored', async () => {
      const { body, blobs } = spillOnce()
      const blob = blobs[0]
      if (blob === undefined) throw new Error('expected a spill')
      const events = mint({ bodies: [body as V2Body], epoch })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'blob-missing' } })
      expect((await harness.plane.head({ threadId: THREAD })).seq).toBe(0)
      expect(await harness.plane.readBlob({ hash: blob.hash })).toBeUndefined()
    })

    it('accepts an event that references an already-stored blob', async () => {
      const { body, blobs } = spillOnce()
      const first = mint({ bodies: [body as V2Body], epoch })
      const won = await harness.plane.append({ threadId: THREAD, epoch, events: first, blobs })
      if (!won.ok) throw new Error('expected the first append to commit')
      const second = mint({ bodies: [body as V2Body], epoch, from: won.head })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events: second })
      expect(outcome.ok).toBe(true)
    })

    it('refuses a mixed batch atomically when one ref is dangling', async () => {
      const kept = spill('kept-'.repeat(5_000))
      const dropped = spill('dropped-'.repeat(5_000))
      const keptBlob = kept.blobs[0]
      const droppedBlob = dropped.blobs[0]
      if (keptBlob === undefined || droppedBlob === undefined) throw new Error('expected spills')
      const events = mint({ bodies: [kept.body as V2Body, dropped.body as V2Body], epoch })
      const outcome = await harness.plane.append({
        threadId: THREAD,
        epoch,
        events,
        blobs: [keptBlob],
      })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'blob-missing' } })
      expect((await harness.plane.head({ threadId: THREAD })).seq).toBe(0)
      expect(await harness.plane.readBlob({ hash: keptBlob.hash })).toBeUndefined()
      expect(await harness.plane.readBlob({ hash: droppedBlob.hash })).toBeUndefined()
    })

    it('reports whether a hash is referenced by an event of the session', async () => {
      const { body, blobs } = spillOnce()
      const blob = blobs[0]
      if (blob === undefined) throw new Error('expected a spill')
      const events = mint({ bodies: [body as V2Body], epoch })
      await harness.plane.append({ threadId: THREAD, epoch, events, blobs })
      expect(await harness.plane.blobReferencedBy({ sessionId: SESSION, hash: blob.hash })).toBe(
        true,
      )
      expect(
        await harness.plane.blobReferencedBy({ sessionId: SESSION, hash: 'f'.repeat(64) }),
      ).toBe(false)
      await harness.plane.createSession(
        createSessionParams({ sessionId: 'other', mainThreadId: 'other-thread' }),
      )
      expect(await harness.plane.blobReferencedBy({ sessionId: 'other', hash: blob.hash })).toBe(
        false,
      )
    })

    it('refuses a tampered blob and commits nothing', async () => {
      const { body, blobs } = spillOnce()
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
