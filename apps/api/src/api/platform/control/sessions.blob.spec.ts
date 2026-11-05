import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  canonicalJson,
  chainEvents,
  spillBody,
  toCallId,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { SessionsService } from './sessions.service'
import { ProjectAccess } from './project-access'

const NOW = '2026-11-03T12:00:00.000Z'

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

describe('SessionsService blob reads', () => {
  const testDb = useTestDatabase()

  const setup = () => {
    const plane = new ControlPlane({ store: new PostgresControlStore(testDb().db) })
    const service = new SessionsService(plane, new FakeProjectAccess())
    return { plane, service }
  }

  const seedSpilledToolResult = async (args: {
    plane: ControlPlane
    service: SessionsService
    userId: string
  }) => {
    const created = await args.service.create({ userId: args.userId, projectId: 'proj-a' })
    const lease = await args.plane.grant({
      sessionId: created.sessionId,
      hostId: 9001,
    })
    const output = { text: 'tool-output-'.repeat(800_000) }
    const { body, blobs } = spillBody({
      body: { type: 'tool-result', callId: toCallId('call-1'), name: 'bash', output },
      thresholdBytes: 262_144,
    })
    const blob = blobs[0]
    if (blob === undefined) throw new Error('expected a spill')
    const outcome = await args.plane.append({
      threadId: created.mainThreadId,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(created.mainThreadId),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: NOW,
        bodies: [body as V2Body],
      }),
      blobs,
    })
    if (!outcome.ok) throw new Error('append refused')
    return { created, blob, output }
  }

  it('pages a 10 MB spilled tool-result under the cap and reads the blob in ranges', async () => {
    const { service, plane } = setup()
    const { created, blob, output } = await seedSpilledToolResult({
      plane,
      service,
      userId: 'user-a',
    })

    const page = await service.events({ userId: 'user-a', sessionId: created.sessionId })
    expect(page.events).toHaveLength(1)
    expect(page.events[0]).toMatchObject({
      type: 'tool-result',
      output: { $blob: { hash: blob.hash, size: blob.bytes.byteLength } },
    })
    expect(JSON.stringify(page).length).toBeLessThan(2_000_000)

    const chunks: Buffer[] = []
    let offset = 0
    for (;;) {
      const part = await service.blob({
        userId: 'user-a',
        sessionId: created.sessionId,
        hash: blob.hash,
        offset,
        length: 1_000_000,
      })
      expect(part.offset).toBe(offset)
      const bytes = Buffer.from(part.bytes, 'base64')
      expect(bytes.byteLength).toBeLessThanOrEqual(1_000_000)
      chunks.push(bytes)
      offset += bytes.byteLength
      if (offset >= part.size) break
    }
    const reassembled = Buffer.concat(chunks)
    expect(reassembled.equals(Buffer.from(canonicalJson(output), 'utf8'))).toBe(true)
  })

  it('never serves another session’s blob or an unreferenced hash', async () => {
    const { service, plane } = setup()
    const { created, blob } = await seedSpilledToolResult({ plane, service, userId: 'user-a' })

    await expect(
      service.blob({ userId: 'user-b', sessionId: created.sessionId, hash: blob.hash }),
    ).rejects.toBeInstanceOf(NotFoundException)

    const second = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await expect(
      service.blob({ userId: 'user-a', sessionId: second.sessionId, hash: blob.hash }),
    ).rejects.toBeInstanceOf(NotFoundException)

    const attackLease = await plane.grant({
      sessionId: second.sessionId,
      hostId: 9002,
    })
    const planted = await plane.append({
      threadId: second.mainThreadId,
      epoch: attackLease.epoch,
      events: chainEvents({
        threadId: toThreadId(second.mainThreadId),
        runId: toRunId('run-2'),
        epoch: attackLease.epoch,
        at: NOW,
        bodies: [{ type: 'user-said', text: `the victim hash is ${blob.hash}` }],
      }),
    })
    expect(planted.ok).toBe(true)
    await expect(
      service.blob({ userId: 'user-a', sessionId: second.sessionId, hash: blob.hash }),
    ).rejects.toBeInstanceOf(NotFoundException)

    await expect(
      service.blob({ userId: 'user-a', sessionId: created.sessionId, hash: 'f'.repeat(64) }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
