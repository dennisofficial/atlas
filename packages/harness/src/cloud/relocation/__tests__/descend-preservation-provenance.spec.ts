import { readFileSync, rmSync, writeFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { eventLogFile, threadMetaFile } from '../../../store/sessions/paths'
import { buildSessionArchive, extractSessionArchive } from '../../session-archive'
import { transferTranscriptDown } from '../descend-transfer'
import { CLOUD_THREAD, fakeCloudChannel } from './fixture'
import {
  base64ArchiveOf,
  said,
  scratchHome,
  seedLocalHistory,
  sessionDirOf,
  stagedArchiveOf,
  stampProvenance,
  useStoreHome,
} from './descend-preserve-fixture'

describe('a serve-stamped empty transcript coming home', () => {
  it('lands a provenance-stamped empty root over local history, as a rewind to zero does', async () => {
    const { home, log, threads, registry } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['first', 'second'] })
    const archive = await stagedArchiveOf({
      drafts: [
        {
          type: 'context-loaded',
          slot: 'capabilities',
          key: 'tools',
          content: 'you can do things',
        },
      ],
      provenance: true,
    })
    const channel = fakeCloudChannel({ archive })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    registry.invalidateSession({ sessionDir: sessionDirOf({ home }) })
    const events = await log.read({ threadId: CLOUD_THREAD })
    expect(events.map((event) => event.type)).toEqual(['context-loaded'])
  })

  it('lands a provenance-stamped archive with an empty root log, as a fresh cloud start does', async () => {
    const { home } = useStoreHome()
    const staging = scratchHome('atlas-descend-preserve-fresh-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('placeholder')] }), 'base64'),
      sessionDir: stagedDir,
    })
    rmSync(eventLogFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }), { force: true })
    writeFileSync(eventLogFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }), '')
    const threadMeta = JSON.parse(
      readFileSync(threadMetaFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }), 'utf8'),
    ) as { head: number }
    writeFileSync(
      threadMetaFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }),
      JSON.stringify({ ...threadMeta, head: 0 }),
    )
    stampProvenance({ sessionDir: stagedDir })
    const fresh = await buildSessionArchive({ sessionDir: stagedDir })
    const channel = fakeCloudChannel({ archive: (fresh ?? Buffer.alloc(0)).toString('base64') })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const landed = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: CLOUD_THREAD }),
      'utf8',
    )
    expect(landed).toBe('')
  })
})
