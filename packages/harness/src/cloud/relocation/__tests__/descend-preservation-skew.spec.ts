import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { EAgentStart, toRunId, toThreadId } from '@dltech/atlas-core'

import { eventLogFile, sessionMetaFile, threadMetaFile } from '../../../store/sessions/paths'
import { transferTranscriptDown } from '../descend-transfer'
import { CLOUD_THREAD, fakeCloudChannel } from './fixture'
import {
  AT,
  archiveOfStagedDir,
  base64ArchiveOf,
  dropChildFiles,
  readLocalLogBytes,
  said,
  scratchHome,
  seedLocalHistory,
  sessionDirBytes,
  sessionDirOf,
  stageFamilyWithChild,
  useStoreHome,
} from './descend-preserve-fixture'
import { extractSessionArchive } from '../../session-archive'

const rewindMetaHead = (args: { stagedDir: string; threadId: string; by: number }): void => {
  const file = threadMetaFile({
    sessionDir: args.stagedDir,
    threadId: toThreadId(args.threadId),
  })
  const meta = JSON.parse(readFileSync(file, 'utf8')) as { head: number }
  writeFileSync(file, JSON.stringify({ ...meta, head: meta.head - args.by }))
}

describe('a crash-torn or meta-lagging transcript coming home', () => {
  it('lands an archive whose metas lag the logs, as a crash between append and meta write leaves them', async () => {
    const { home } = useStoreHome()
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const family = await stageFamilyWithChild({ child })
    rewindMetaHead({ stagedDir: family.stagedDir, threadId: CLOUD_THREAD, by: 1 })
    rewindMetaHead({ stagedDir: family.stagedDir, threadId: child, by: 1 })
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const landed = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: child }),
      'utf8',
    )
    expect(landed).toContain('child speaks')
  })

  it('lands a torn-tail root snapshot with the torn bytes preserved raw', async () => {
    const { home } = useStoreHome()
    const staging = scratchHome('atlas-descend-preserve-torn-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('one'), said('two')] }), 'base64'),
      sessionDir: stagedDir,
    })
    const tornBytes = Buffer.from('{"v":1,"id":"evt_torn","seq":3')
    appendFileSync(eventLogFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }), tornBytes)
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const landed = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: CLOUD_THREAD }),
    )
    expect(landed.subarray(landed.length - tornBytes.length).equals(tornBytes)).toBe(true)
  })

  it('refuses a root log that ends short of its metadata with no torn tail', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = readLocalLogBytes({ home })
    const staging = scratchHome('atlas-descend-preserve-short-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('one')] }), 'base64'),
      sessionDir: stagedDir,
    })
    const metaFile = threadMetaFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD })
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { head: number }
    writeFileSync(metaFile, JSON.stringify({ ...meta, head: meta.head + 3 }))
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'decodes to head',
    )

    expect(readLocalLogBytes({ home })).toEqual(before)
  })

  it('lands a child log that ends torn ahead of its metadata, torn bytes preserved', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const family = await stageFamilyWithChild({ child })
    const tornBytes = Buffer.from('{"v":1,"id":"evt_torn","seq":2')
    appendFileSync(eventLogFile({ sessionDir: family.stagedDir, threadId: child }), tornBytes)
    const metaFile = threadMetaFile({ sessionDir: family.stagedDir, threadId: child })
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { head: number }
    writeFileSync(metaFile, JSON.stringify({ ...meta, head: meta.head + 1 }))
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const landed = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: child }),
    )
    expect(landed.subarray(landed.length - tornBytes.length).equals(tornBytes)).toBe(true)
  })

  it('refuses a child log that ends short of its metadata with no torn tail', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const before = sessionDirBytes({ home })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const family = await stageFamilyWithChild({ child })
    const metaFile = threadMetaFile({ sessionDir: family.stagedDir, threadId: child })
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { head: number }
    writeFileSync(metaFile, JSON.stringify({ ...meta, head: meta.head + 1 }))
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'decodes to head',
    )

    expect(sessionDirBytes({ home })).toEqual(before)
  })

  it('refuses a child log with a malformed mid-file row, local bytes intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const before = sessionDirBytes({ home })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const family = await stageFamilyWithChild({ child })
    appendFileSync(
      eventLogFile({ sessionDir: family.stagedDir, threadId: child }),
      `${JSON.stringify({ v: 1, id: 'evt_bad', seq: 2, threadId: child, runId: 'run_x', depth: 0, at: AT, type: 'user-said', body: { type: 'user-said', text: 42 } })}\n`,
    )
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'unreadable rows',
    )

    expect(sessionDirBytes({ home })).toEqual(before)
  })

  it('refuses an archive with no main-thread row even when meta.json and the root log are valid', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['real history'] })
    const before = sessionDirBytes({ home })
    const staging = scratchHome('atlas-descend-preserve-noroot-')
    const stagedDir = sessionDirOf({ home: staging })
    await extractSessionArchive({
      archive: Buffer.from(await base64ArchiveOf({ drafts: [said('up there')] }), 'base64'),
      sessionDir: stagedDir,
    })
    rmSync(threadMetaFile({ sessionDir: stagedDir, threadId: CLOUD_THREAD }), { force: true })
    expect(readFileSync(sessionMetaFile({ sessionDir: stagedDir }), 'utf8')).toContain(CLOUD_THREAD)
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'no readable metadata',
    )

    expect(sessionDirBytes({ home })).toEqual(before)
  })

  it('refuses when the root-referenced child is missing even though the root itself is valid', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const before = sessionDirBytes({ home })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const family = await stageFamilyWithChild({ child })
    dropChildFiles({ stagedDir: family.stagedDir, child })
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      `still references child ${child}`,
    )

    expect(sessionDirBytes({ home })).toEqual(before)
  })

  it('reads a spawn the root made at the seam between family validation and landing', async () => {
    const { home, threads, log } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const family = await stageFamilyWithChild({ child })
    await family.log.append({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_late_spawn'),
      drafts: [
        {
          type: 'agent-spawned',
          agentId: toThreadId(`${CLOUD_THREAD}/late`),
          agentType: 'explore',
          intent: 'a late spawn',
          mode: EAgentStart.Fresh,
        },
      ],
    })
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      `still references child ${CLOUD_THREAD}/late`,
    )
    expect((await log.read({ threadId: CLOUD_THREAD })).map((event) => event.type)).toEqual([
      'user-said',
    ])
  })
})
