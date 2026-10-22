import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toRunId, type EventDraft } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, sessionMetaSchema, threadMetaSchema } from '../meta'
import { sessionDirectory, sessionMetaFile, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-session-membership-'))
  directories.push(dir)
  return dir
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })

function openStore({ home }: { home: string }): JsonlThreadStore {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return new JsonlThreadStore(home, registry, clock, ids, log)
}

describe('session membership at thread creation', () => {
  it('places a main created with sessionId into the existing session directory', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const main = await threads.create({ title: 'original main' })
    const successor = await threads.create({ title: 'rotated in', sessionId: main.id })

    const sessionDir = sessionDirectory({ home, sessionId: main.id })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: successor.id }), schema: threadMetaSchema })
    expect(meta?.spawnerThreadId).toBeNull()
    expect(meta?.agentType).toBeNull()

    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session?.id).toBe(main.id)

    const foreignDir = sessionDirectory({ home, sessionId: successor.id })
    expect(readMetaSync({ file: threadMetaFile({ sessionDir: foreignDir, threadId: successor.id }), schema: threadMetaSchema })).toBeUndefined()
  })

  it('keeps a main created with sessionId findable through the registry', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const main = await threads.create({})
    const successor = await threads.create({ sessionId: main.id })

    const reopened = openStore({ home })
    const found = await reopened.find({ threadId: successor.id })
    expect(found?.id).toBe(successor.id)
    expect(found?.agent).toBeUndefined()
  })

  it('still opens a fresh session for a main without sessionId', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const main = await threads.create({})

    const sessionDir = sessionDirectory({ home, sessionId: main.id })
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session?.id).toBe(main.id)
  })

  it('still places a supervised child in its spawner\u2019s session', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const main = await threads.create({})
    const child = await threads.create({ agent: { spawnedBy: main.id, type: 'explore' } })

    const sessionDir = sessionDirectory({ home, sessionId: main.id })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: child.id }), schema: threadMetaSchema })
    expect(meta?.spawnerThreadId).toBe(main.id)
  })

  it('places a first-events main with sessionId into the existing session directory', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const main = await threads.create({})
    const { thread } = await threads.createWithFirstEvents({
      drafts: [said('pick up from here')],
      runId: toRunId('run-rotate-in'),
      sessionId: main.id,
    })

    const sessionDir = sessionDirectory({ home, sessionId: main.id })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: thread.id }), schema: threadMetaSchema })
    expect(meta?.spawnerThreadId).toBeNull()
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session?.id).toBe(main.id)
  })
})
