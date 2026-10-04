import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { sessionDirectory, threadMetaFile, threadsDirectory } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-transferred-lookup-'))
  directories.push(dir)
  return dir
}

function openStore({ home }: { home: string }): { threads: JsonlThreadStore; log: JsonlEventLog } {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return { log, threads: new JsonlThreadStore(home, registry, clock, ids, log) }
}

async function dropTransferredChildMeta(args: {
  home: string
  rootId: string
  childId: string
}): Promise<void> {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: toThreadId(args.rootId) })
  await mkdir(threadsDirectory({ sessionDir }), { recursive: true })
  await writeFile(
    threadMetaFile({ sessionDir, threadId: toThreadId(args.childId) }),
    JSON.stringify({
      v: 1,
      id: args.childId,
      title: 'teammate "Remove legacy harness.db importer"',
      head: 172,
      createdAt: '2026-10-04T00:27:53.241Z',
      updatedAt: '2026-10-04T00:41:25.649Z',
      parentThreadId: null,
      forkSeq: null,
      forkMode: null,
      spawnerThreadId: args.rootId,
      agentType: 'teammate',
      workspace: '/atlas/workspace/.atlas/worktrees/drop-harness-db',
      repo: '/atlas/workspace',
      modelRef: 'inference/kimi-k3-fast',
      modelEffort: 'high',
      executionLocation: 'cloud',
      placement: null,
      parkedTranscript: null,
    }),
  )
}

describe('finding a transferred teammate after the thread index was already built', () => {
  it('a transferred teammate resolves once its meta lands, even if the index was built first', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })

    const root = await threads.create({ title: 'Remove legacy database importer' })
    const childId = toThreadId('brn_11999363-f6af-4af3-9482-b201999c2c74')

    // Force the one-time index scan BEFORE the transferred child's meta lands. A lookup for a
    // thread the index does not know is what trips `sessionDirOf` past its early return into
    // `scanThreadIndex` — as happens on a fresh boot opening threads before the archive extracts.
    await threads.find({ threadId: toThreadId('brn_an-unrelated-thread') })

    // The transcript archive then extracts the transferred teammate's meta into the session dir.
    await dropTransferredChildMeta({ home, rootId: root.id, childId })

    // The resume path (savedChildModel -> threads.find) asks for the child. The registry must see
    // the meta that landed after its one-time scan, or savedChildModel throws
    // `no child thread named <id>` and the teammate never resumes.
    const found = await threads.find({ threadId: childId })
    expect(found?.id).toBe(childId)
  })

  it('the same meta is found when the index is built after it lands', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })

    const root = await threads.create({ title: 'Remove legacy database importer' })
    const childId = toThreadId('brn_11999363-f6af-4af3-9482-b201999c2c74')

    await dropTransferredChildMeta({ home, rootId: root.id, childId })

    const found = await threads.find({ threadId: childId })
    expect(found?.id).toBe(childId)
  })
})
