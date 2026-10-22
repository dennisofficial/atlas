import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, sessionMetaSchema, writeMeta } from '../meta'
import { sessionDirectory, sessionMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlSessionAuthority } from '../session-authority'
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
    authority: new JsonlSessionAuthority({ registry }),
    clock,
    ids,
    threads: new JsonlThreadStore(home, registry, clock, ids, log),
  }
}

describe('JsonlSessionAuthority reads', () => {
  it('reads a session that predates the field as its own sole active main', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({ title: 'the only main' })

    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(main.id)
    expect(await authority.mainGenerationOf({ threadId: main.id })).toBe(1)
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({
      allowed: true,
      generation: 1,
    })
    expect(await authority.fenceMainThread({ threadId: main.id, generation: 1 })).toEqual({
      allowed: true,
      generation: 1,
    })
  })

  it('answers undefined for a session that does not exist', async () => {
    const home = await tempHome()
    const { authority } = openStore({ home })

    expect(await authority.activeMainOf({ sessionId: 'spec-404' })).toBeUndefined()
    expect(await authority.mainGenerationOf({ threadId: toThreadId('spec-404') })).toBeUndefined()
    expect(await authority.fenceMainThread({ threadId: toThreadId('spec-404') })).toEqual({
      allowed: false,
      activeMain: null,
    })
  })

  it('fences a stale generation without mutating', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})

    expect(await authority.fenceMainThread({ threadId: main.id, generation: 0 })).toEqual({
      allowed: false,
      activeMain: main.id,
    })
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({
      allowed: true,
      generation: 1,
    })
  })

  it('refuses a thread that is not the session main at all', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const child = await threads.create({ agent: { spawnedBy: main.id, type: 'explore' } })

    expect(await authority.fenceMainThread({ threadId: child.id })).toEqual({
      allowed: false,
      activeMain: main.id,
    })
    expect(await authority.mainGenerationOf({ threadId: child.id })).toBeUndefined()
  })
})

describe('JsonlSessionAuthority with a committed active main', () => {
  it('reads and fences the committed active main from disk', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })
    const file = sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) })
    const meta = readMetaSync({ file, schema: sessionMetaSchema })
    await writeMeta({ file, meta: { ...meta, activeMainThreadId: successor.id } })

    const reopened = openStore({ home }).authority
    expect(await reopened.activeMainOf({ sessionId: main.id })).toBe(successor.id)
    expect(await reopened.fenceMainThread({ threadId: main.id })).toEqual({
      allowed: false,
      activeMain: successor.id,
    })
    expect(await reopened.fenceMainThread({ threadId: successor.id })).toEqual({
      allowed: true,
      generation: 1,
    })
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

    const authority = openStore({ home }).authority
    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(main.id)
  })
})

describe('session meta written by a rotating Atlas', () => {
  const OLD_ROTATION = {
    predecessor: 'old-main',
    successor: 'old-successor',
    handoffPath: '/tmp/handoff.md',
    watermarkSeq: 42,
    operationId: 'op-1',
    status: 'committed',
    updatedAt: '2026-10-07T00:00:00.000Z',
  }

  it('still parses a meta that carries the retired rotation record', async () => {
    const home = await tempHome()
    const { authority, threads } = openStore({ home })
    const main = await threads.create({})
    const file = sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: main.id }) })
    const meta = readMetaSync({ file, schema: sessionMetaSchema })
    await writeMeta({
      file,
      meta: { ...meta, activeMainThreadId: 'old-successor', rotation: OLD_ROTATION },
    })

    const parsed = readMetaSync({ file, schema: sessionMetaSchema })
    expect(parsed?.id).toBe(main.id)
    expect(parsed?.activeMainThreadId).toBe('old-successor')
    expect(parsed).not.toHaveProperty('rotation')
    expect(await authority.activeMainOf({ sessionId: main.id })).toBe(toThreadId('old-successor'))
    expect(await authority.fenceMainThread({ threadId: main.id })).toEqual({
      allowed: false,
      activeMain: toThreadId('old-successor'),
    })
  })
})
