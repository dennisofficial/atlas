import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { eventLogFile, sessionLockFile } from '../../../store/sessions/paths'
import { buildSessionArchive, extractSessionArchive } from '../../session-archive'
import { transferTranscriptDown } from '../descend-transfer'
import { CLOUD_THREAD, fakeCloudChannel } from './fixture'
import {
  archiveOfStagedDir,
  base64ArchiveOf,
  dropChildFiles,
  familyArchiveWithChild,
  said,
  seedLocalHistory,
  sessionDirBytes,
  sessionDirOf,
  spawnGrandchild,
  stageFamilyWithChild,
  tearChildLog,
  useStoreHome,
} from './descend-preserve-fixture'

describe('the descend validating the incoming family', () => {
  it('refuses an archive whose retained child files are missing, whole session dir intact', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const before = sessionDirBytes({ home })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const archive = await familyArchiveWithChild({
      child,
      mutate: ({ stagedDir }) => dropChildFiles({ stagedDir, child }),
    })
    const channel = fakeCloudChannel({ archive })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      'still references child',
    )

    expect(sessionDirBytes({ home })).toEqual(before)
  })

  it('lands an archive whose child log ends torn, preserving the torn bytes raw', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const archive = await familyArchiveWithChild({
      child,
      mutate: ({ stagedDir }) => tearChildLog({ stagedDir, child }),
    })
    const channel = fakeCloudChannel({ archive })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const landed = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: child }),
    )
    const torn = Buffer.from('{"v":1,"id":"evt_torn","seq":2')
    expect(landed.subarray(landed.length - torn.length).equals(torn)).toBe(true)
    expect(landed.toString('utf8')).toContain('child speaks')
  })

  it('lands a family archive whose child is retained with a matching head', async () => {
    const { home } = useStoreHome()
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const channel = fakeCloudChannel({
      archive: await familyArchiveWithChild({ child, mutate: () => undefined }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const childText = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: child }),
      'utf8',
    )
    expect(childText).toContain('child speaks')
    const parentText = readFileSync(
      eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: CLOUD_THREAD }),
      'utf8',
    )
    expect(parentText).toContain('agent-spawned')
  })

  it('still lands a valid cloud transcript wholesale over diverged local history', async () => {
    const { home, log, threads, registry } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['something else entirely'] })
    const channel = fakeCloudChannel({
      archive: await base64ArchiveOf({ drafts: [said('one'), said('two')] }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    registry.invalidateSession({ sessionDir: sessionDirOf({ home }) })
    const texts = (await log.read({ threadId: CLOUD_THREAD })).map(
      (event) => (event as { text?: string }).text,
    )
    expect(texts).toEqual(['one', 'two'])
  })

  it('still lands a valid archive for a conversation that only ever lived in the cloud', async () => {
    const { home, log } = useStoreHome()
    const channel = fakeCloudChannel({
      archive: await base64ArchiveOf({ drafts: [said('born up there')] }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const texts = (await log.read({ threadId: CLOUD_THREAD })).map(
      (event) => (event as { text?: string }).text,
    )
    expect(texts).toEqual(['born up there'])
  })

  it('lays the session lock down again after the archive lands', async () => {
    const { home } = useStoreHome()
    const channel = fakeCloudChannel({
      archive: await base64ArchiveOf({ drafts: [said('one')] }),
    })

    await transferTranscriptDown({ threadId: CLOUD_THREAD, channel })

    const lock = JSON.parse(
      readFileSync(sessionLockFile({ sessionDir: sessionDirOf({ home }) }), 'utf8'),
    ) as { pid: number }
    expect(lock.pid).toBe(process.pid)
  })
})

describe('a spawn reference made by a child, not the root', () => {
  it('refuses when the grandchild a child spawned is missing from the archive', async () => {
    const { home, threads } = useStoreHome()
    await seedLocalHistory({ home, threads, texts: ['parent speaks'] })
    const before = sessionDirBytes({ home })
    const child = toThreadId(`${CLOUD_THREAD}/kid`)
    const grandchild = toThreadId(`${CLOUD_THREAD}/kid/grand`)
    const family = await stageFamilyWithChild({ child })
    await spawnGrandchild({ family, child, grandchild })
    dropChildFiles({ stagedDir: family.stagedDir, child: grandchild })
    const childLog = readFileSync(
      eventLogFile({ sessionDir: family.stagedDir, threadId: child }),
      'utf8',
    )
    expect(childLog).toContain('agent-spawned')
    const channel = fakeCloudChannel({
      archive: await archiveOfStagedDir({ stagedDir: family.stagedDir }),
    })

    await expect(transferTranscriptDown({ threadId: CLOUD_THREAD, channel })).rejects.toThrow(
      `still references child ${grandchild}`,
    )

    expect(sessionDirBytes({ home })).toEqual(before)
  })
})
