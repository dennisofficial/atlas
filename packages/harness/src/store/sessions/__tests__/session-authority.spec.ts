import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { ERotationStatus, readMetaSync, sessionMetaSchema, type RotationRecord } from '../meta'
import { sessionDirectory, sessionMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlSessionAuthority, MainConflict } from '../session-authority'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-session-authority-'))
  directories.push(dir)
  return dir
}

function openStore({ home }: { home: string }): {
  authority: JsonlSessionAuthority
  clock: SteppingClock
  ids: CountingIds
  threads: JsonlThreadStore
} {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return {
    authority: new JsonlSessionAuthority({ registry, clock }),
    clock,
    ids,
    threads: new JsonlThreadStore(home, registry, clock, ids, log),
  }
}

function rotation(args: Partial<RotationRecord> & Pick<RotationRecord, 'predecessor' | 'successor'>): RotationRecord {
  return {
    handoffPath: null,
    watermarkSeq: 42,
    status: ERotationStatus.Preparing,
    updatedAt: '2026-10-07T00:00:00.000Z',
    ...args,
  }
}

describe('JsonlSessionAuthority reads', () => {
  it('reads a session that predates the field as its own sole active main', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({ title: 'the only main' })

    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(main.id)
    expect(await authority.mainGenerationOf({ threadId: main.id })).toBe(1)
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({ allowed: true, generation: 1 })
    expect(await authority.fenceMainThread({ threadId: main.id, generation: 1 })).toEqual({ allowed: true, generation: 1 })
  })

  it('answers undefined for a session that does not exist', async () => {
    const home = await tempHome()
    const { authority } = openStore({ home })

    expect(await authority.activeMainOf({ sessionId: 'spec-404' })).toBeUndefined()
    expect(await authority.mainGenerationOf({ threadId: toThreadId('spec-404') })).toBeUndefined()
    expect(await authority.fenceMainThread({ threadId: toThreadId('spec-404') })).toEqual({ allowed: false, activeMain: null })
  })

  it('fences a stale generation without mutating', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})

    expect(await authority.fenceMainThread({ threadId: main.id, generation: 0 })).toEqual({
      allowed: false,
      activeMain: main.id,
    })
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({ allowed: true, generation: 1 })
  })

  it('refuses a thread that is not the session main at all', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const child = await threads.create({ agent: { spawnedBy: main.id, type: 'explore' } })

    expect(await authority.fenceMainThread({ threadId: child.id })).toEqual({ allowed: false, activeMain: main.id })
    expect(await authority.mainGenerationOf({ threadId: child.id })).toBeUndefined()
  })
})

describe('JsonlSessionAuthority rotation writes', () => {
  it('commits a rotation and fences the predecessor out', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })

    await authority.writeRotation({
      sessionId: main.id,
      write: {
        rotation: rotation({ predecessor: main.id, successor: successor.id, status: ERotationStatus.Committed }),
        expectedActiveMain: main.id,
        nextActiveMain: successor.id,
      },
    })

    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(successor.id)
    expect(await authority.fenceMainThread({ threadId: successor.id })).toEqual({ allowed: true, generation: 1 })
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({ allowed: false, activeMain: successor.id })
    expect(await authority.mainGenerationOf({ threadId: main.id })).toBe(0)

    const meta = readMetaSync({
      file: sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) }),
      schema: sessionMetaSchema,
    })
    expect(meta?.activeMainThreadId).toBe(successor.id)
    expect(meta?.rotation).toMatchObject({ predecessor: main.id, successor: successor.id, status: 'committed' })
  })

  it('refuses to write against an expected main that no longer holds authority', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })
    const third = await threads.create({ sessionId: main.id })

    await authority.writeRotation({
      sessionId: main.id,
      write: {
        rotation: rotation({ predecessor: main.id, successor: successor.id, status: ERotationStatus.Committed }),
        expectedActiveMain: main.id,
        nextActiveMain: successor.id,
      },
    })

    await expect(
      authority.writeRotation({
        sessionId: main.id,
        write: {
          rotation: rotation({ predecessor: main.id, successor: third.id }),
          expectedActiveMain: main.id,
          nextActiveMain: third.id,
        },
      }),
    ).rejects.toBeInstanceOf(MainConflict)

    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(successor.id)
  })

  it('records a preparing rotation without moving authority', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })

    await authority.writeRotation({
      sessionId: main.id,
      write: {
        rotation: rotation({ predecessor: main.id, successor: successor.id, status: ERotationStatus.Preparing }),
        expectedActiveMain: main.id,
      },
    })

    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(main.id)
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({ allowed: true, generation: 1 })
    const meta = readMetaSync({
      file: sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) }),
      schema: sessionMetaSchema,
    })
    expect(meta?.rotation?.status).toBe(ERotationStatus.Preparing)
    expect(meta?.rotation?.watermarkSeq).toBe(42)
  })

  it('serializes two concurrent commits and lets exactly one through', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })
    const third = await threads.create({ sessionId: main.id })

    const attempt = (successorId: string) =>
      authority.writeRotation({
        sessionId: main.id,
        write: {
          rotation: rotation({ predecessor: main.id, successor: successorId, status: ERotationStatus.Committed }),
          expectedActiveMain: main.id,
          nextActiveMain: toThreadId(successorId),
        },
      })
    const results = await Promise.allSettled([attempt(successor.id), attempt(third.id)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(MainConflict)
    const final = await authority.activeMainOf({ sessionId: main.id })
    if (final === undefined) throw new Error('the session lost its active main')
    expect([successor.id, third.id]).toContain(final)
  })
})

describe('JsonlSessionAuthority recovery', () => {
  it('resolves an interrupted preparing rotation back to the predecessor', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })

    await authority.writeRotation({
      sessionId: main.id,
      write: {
        rotation: rotation({ predecessor: main.id, successor: successor.id }),
        expectedActiveMain: main.id,
      },
    })
    await authority.recoverInterruptedRotation({ sessionId: main.id })

    const meta = readMetaSync({
      file: sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) }),
      schema: sessionMetaSchema,
    })
    expect(meta?.rotation?.status).toBe(ERotationStatus.Aborted)
    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(main.id)
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({ allowed: true, generation: 1 })
  })

  it('leaves a committed rotation untouched during recovery', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })

    await authority.writeRotation({
      sessionId: main.id,
      write: {
        rotation: rotation({ predecessor: main.id, successor: successor.id, status: ERotationStatus.Committed }),
        expectedActiveMain: main.id,
        nextActiveMain: successor.id,
      },
    })
    await authority.recoverInterruptedRotation({ sessionId: main.id })

    const meta = readMetaSync({
      file: sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) }),
      schema: sessionMetaSchema,
    })
    expect(meta?.rotation?.status).toBe(ERotationStatus.Committed)
    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(successor.id)
  })

  it('rebuilds the committed active main from disk after a fresh registry scan', async () => {
    const home = await tempHome()
    const first = openStore({ home })
    const main = await first.threads.create({})
    const successor = await first.threads.create({ sessionId: main.id })
    await first.authority.writeRotation({
      sessionId: main.id,
      write: {
        rotation: rotation({ predecessor: main.id, successor: successor.id, status: ERotationStatus.Committed }),
        expectedActiveMain: main.id,
        nextActiveMain: successor.id,
      },
    })

    const reopened = openStore({ home })
    expect(await reopened.authority.activeMainOf({ sessionId: main.id })).toBe(successor.id)
    expect(await reopened.authority.fenceMainThread({ threadId: main.id })).toEqual({ allowed: false, activeMain: successor.id })
    expect(await reopened.authority.fenceMainThread({ threadId: successor.id })).toEqual({ allowed: true, generation: 1 })
  })
})

describe('session meta backward compatibility', () => {
  it('round-trips a meta written before the authority fields existed', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    const main = await threads.create({})

    const file = sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) })
    const meta = readMetaSync({ file, schema: sessionMetaSchema })
    expect(meta?.activeMainThreadId).toBeUndefined()
    expect(meta?.rotation).toBeUndefined()

    const authority = openStore({ home }).authority
    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(main.id)
  })
})
