import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type EventDraft } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { SessionRegistry } from '../registry'
import { FileThreadReadCursor } from '../read-cursor'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const thread = toThreadId('brn_main')

async function openCursor({ home }: { home: string }): Promise<{
  cursor: FileThreadReadCursor
  log: JsonlEventLog
  ids: CountingIds
}> {
  const registry = new SessionRegistry(home)
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, new SteppingClock(), ids)
  return { cursor: new FileThreadReadCursor({ registry, log }), log, ids }
}

async function seed({ home, events }: { home: string; events: number }) {
  const { log, ids } = await openCursor({ home })
  const drafts: EventDraft[] = Array.from({ length: events }, (_, index) => ({
    type: 'nudge',
    text: `n${index}`,
    lifetimeSteps: 1,
  }))
  await log.append({ threadId: thread, runId: ids.nextRunId(), drafts })
}

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-cursor-'))
  directories.push(dir)
  return dir
}

describe('FileThreadReadCursor', () => {
  it('reads undefined before any mark', async () => {
    const home = await tempHome()
    await seed({ home, events: 3 })
    const { cursor } = await openCursor({ home })
    expect(await cursor.readSeq({ threadId: thread })).toBeUndefined()
  })

  it('persists across instances', async () => {
    const home = await tempHome()
    await seed({ home, events: 5 })
    const first = await openCursor({ home })
    expect(await first.cursor.markRead({ threadId: thread, seq: 4 })).toBe(4)
    const second = await openCursor({ home })
    expect(await second.cursor.readSeq({ threadId: thread })).toBe(4)
  })

  it('clamps to the log head', async () => {
    const home = await tempHome()
    await seed({ home, events: 3 })
    const { cursor } = await openCursor({ home })
    expect(await cursor.markRead({ threadId: thread, seq: 99 })).toBe(3)
    expect(await cursor.readSeq({ threadId: thread })).toBe(3)
  })

  it('never regresses within head', async () => {
    const home = await tempHome()
    await seed({ home, events: 5 })
    const { cursor } = await openCursor({ home })
    await cursor.markRead({ threadId: thread, seq: 4 })
    expect(await cursor.markRead({ threadId: thread, seq: 2 })).toBe(4)
  })
})
