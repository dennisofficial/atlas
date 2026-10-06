import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { eventLogFile, sessionMetaFile } from '../../../store/sessions/paths'
import { transferTranscriptDown } from '../descend-transfer'
import { TRANSCRIPT_ORIGIN_FILE_NAME } from '../descend-validate'
import { cloudHolding } from './descend-cloud-holding'
import { archiveDescriptorOf, exportedArchiveOf, extractExportInto } from './fake-cloud-bridge'
import { CLOUD_THREAD } from './fixture'
import {
  AT,
  fileArchiveOf,
  capabilitiesOnlyArchive,
  readLocalLogBytes,
  said,
  scratchHome,
  seedLocalHistory,
  sessionDirOf,
  useStoreHome,
} from './descend-preserve-fixture'

describe('the descend refusing a bogus cloud transcript', () => {
  it('refuses a malformed archive and leaves the local log byte-for-byte intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const damaged = join(scratchHome('atlas-descend-preserve-damaged-'), 'damaged.tar.gz')
    writeFileSync(damaged, 'not a tar at all')
    const cloud = cloudHolding({ archive: await exportedArchiveOf({ file: damaged }) })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow()

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses an archive with no root metadata and leaves the local log intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const cloud = cloudHolding({
      archive: await fileArchiveOf({ drafts: [said('orphaned log')], rootMeta: false }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'no root metadata',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses an archive whose root metadata names a different session, local log intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const staging = scratchHome('atlas-descend-preserve-mismatch-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractExportInto({
      archive: await fileArchiveOf({ drafts: [said('up there')] }),
      sessionDir: stagedDir,
    })
    const metaFile = sessionMetaFile({ sessionDir: stagedDir })
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { id: string }
    writeFileSync(metaFile, JSON.stringify({ ...meta, id: 'brn_someone-else' }))
    const cloud = cloudHolding({ archive: await archiveDescriptorOf({ sessionDir: stagedDir }) })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'names a different session',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses an archive whose root log is partly unreadable, local log intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const staging = scratchHome('atlas-descend-preserve-corrupt-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractExportInto({
      archive: await fileArchiveOf({ drafts: [said('up there')] }),
      sessionDir: stagedDir,
    })
    appendFileSync(
      eventLogFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }),
      `${JSON.stringify({ v: 1, id: 'evt_bad', seq: 2, threadId: CLOUD_THREAD, runId: 'run_cloud_seed', depth: 0, at: AT, type: 'user-said', body: { type: 'user-said', text: 42 } })}\n`,
    )
    const cloud = cloudHolding({ archive: await archiveDescriptorOf({ sessionDir: stagedDir }) })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'unreadable rows',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses an archive whose root log is missing and leaves the local log intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const staging = scratchHome('atlas-descend-preserve-strip-')
    const strippedDir = sessionDirOf({ home: staging })
    await extractExportInto({
      archive: await fileArchiveOf({ drafts: [said('up there')] }),
      sessionDir: strippedDir,
    })
    rmSync(eventLogFile({ sessionDir: strippedDir, threadId: CLOUD_THREAD }), { force: true })
    const cloud = cloudHolding({ archive: await archiveDescriptorOf({ sessionDir: strippedDir }) })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'no readable main-thread event log',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses a capabilities-only archive over local history, byte-for-byte', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['first', 'second'] })
    const before = readLocalLogBytes({ home })
    const cloud = cloudHolding({ archive: await capabilitiesOnlyArchive() })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'no serve-stamped provenance',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('still refuses a provenance marker that names a different session', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const staging = scratchHome('atlas-descend-preserve-forge-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractExportInto({
      archive: await capabilitiesOnlyArchive(),
      sessionDir: stagedDir,
    })
    writeFileSync(
      join(stagedDir, TRANSCRIPT_ORIGIN_FILE_NAME),
      JSON.stringify({ threadId: 'brn_someone-else', archiveDigest: null, initialized: true }),
    )
    const cloud = cloudHolding({ archive: await archiveDescriptorOf({ sessionDir: stagedDir }) })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'provenance marker names a different session',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('still refuses an empty archive before touching the local copy', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['only ever local'] })
    const before = readLocalLogBytes({ home })
    const cloud = cloudHolding({ archive: null })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, ...cloud })).rejects.toThrow(
      'the cloud holds no transcript',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })
})
