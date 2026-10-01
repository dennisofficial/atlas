import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { eventLogFile, sessionMetaFile } from '../../../store/sessions/paths'
import { buildSessionArchive, extractSessionArchive } from '../../session-archive'
import { transferTranscriptDown } from '../descend-transfer'
import { TRANSCRIPT_ORIGIN_FILE_NAME } from '../descend-validate'
import { CLOUD_THREAD, fakeCloudChannel } from './fixture'
import {
  AT,
  base64ArchiveOf,
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
    const channel = fakeCloudChannel({
      archive: Buffer.from('not a tar at all').toString('base64'),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow()

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses an archive with no root metadata and leaves the local log intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const channel = fakeCloudChannel({
      archive: await base64ArchiveOf({ drafts: [said('orphaned log')], rootMeta: false }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
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
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('up there')] }), 'base64'),
      sessionDir: stagedDir,
    })
    const metaFile = sessionMetaFile({ sessionDir: stagedDir })
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { id: string }
    writeFileSync(metaFile, JSON.stringify({ ...meta, id: 'brn_someone-else' }))
    const mismatched = await buildSessionArchive({ sessionDir: stagedDir })
    const channel = fakeCloudChannel({
      archive: (mismatched ?? Buffer.alloc(0)).toString('base64'),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
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
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('up there')] }), 'base64'),
      sessionDir: stagedDir,
    })
    appendFileSync(
      eventLogFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }),
      `${JSON.stringify({ v: 1, id: 'evt_bad', seq: 2, threadId: CLOUD_THREAD, runId: 'run_cloud_seed', depth: 0, at: AT, type: 'user-said', body: { type: 'user-said', text: 42 } })}\n`,
    )
    const corrupted = await buildSessionArchive({ sessionDir: stagedDir })
    const channel = fakeCloudChannel({ archive: (corrupted ?? Buffer.alloc(0)).toString('base64') })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
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
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('up there')] }), 'base64'),
      sessionDir: strippedDir,
    })
    rmSync(eventLogFile({ sessionDir: strippedDir, threadId: CLOUD_THREAD }), { force: true })
    const stripped = await buildSessionArchive({ sessionDir: strippedDir })
    const channel = fakeCloudChannel({ archive: (stripped ?? Buffer.alloc(0)).toString('base64') })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'no readable main-thread event log',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('refuses a capabilities-only archive over local history, byte-for-byte', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['first', 'second'] })
    const before = readLocalLogBytes({ home })
    const channel = fakeCloudChannel({ archive: await capabilitiesOnlyArchive() })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
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
    await extractSessionArchive({
      archive: Buffer.from(await capabilitiesOnlyArchive(), 'base64'),
      sessionDir: stagedDir,
    })
    writeFileSync(
      join(stagedDir, TRANSCRIPT_ORIGIN_FILE_NAME),
      JSON.stringify({ threadId: 'brn_someone-else', archiveDigest: null, initialized: true }),
    )
    const forged = await buildSessionArchive({ sessionDir: stagedDir })
    const channel = fakeCloudChannel({ archive: (forged ?? Buffer.alloc(0)).toString('base64') })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'provenance marker names a different session',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('still refuses an empty archive before touching the local copy', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['only ever local'] })
    const before = readLocalLogBytes({ home })
    const channel = fakeCloudChannel({ archive: '' })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'the cloud holds no transcript',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })
})
