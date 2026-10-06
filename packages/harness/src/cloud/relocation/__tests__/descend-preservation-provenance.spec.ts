import { readFileSync, rmSync, writeFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { eventLogFile, threadMetaFile } from '../../../store/sessions/paths'
import { transferTranscriptDown } from '../descend-transfer'
import { cloudHolding } from './descend-cloud-holding'
import { archiveDescriptorOf, extractExportInto } from './fake-cloud-bridge'
import { CLOUD_THREAD } from './fixture'
import {
  fileArchiveOf,
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
    const cloud = cloudHolding({ archive })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })

    registry.invalidateSession({ sessionDir: sessionDirOf({ home }) })
    const events = await log.read({ threadId: CLOUD_THREAD })
    expect(events.map((event) => event.type)).toEqual(['context-loaded'])
  })

  it('lands a provenance-stamped archive with an empty root log, as a fresh cloud start does', async () => {
    const { home } = useStoreHome()
    const staging = scratchHome('atlas-descend-preserve-fresh-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractExportInto({
      archive: await fileArchiveOf({ drafts: [said('placeholder')] }),
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
    const cloud = cloudHolding({ archive: await archiveDescriptorOf({ sessionDir: stagedDir }) })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })

    const landed = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: CLOUD_THREAD }),
      'utf8',
    )
    expect(landed).toBe('')
  })
})
