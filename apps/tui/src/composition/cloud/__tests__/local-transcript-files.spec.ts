import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stampEvent, toEventId, toRunId, type Event } from '@dltech/atlas-core'
import { JsonlEventLog, RandomIds, registryFor, SystemClock, transcriptIdentityDigest } from '@dltech/atlas-harness'

import { localTranscriptFiles } from '../local-transcript-files'
import { CLOUD_THREAD } from './fixture'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const eventAt = (seq: number): Event =>
  stampEvent({
    draft: { type: 'user-said', text: `said ${seq}` },
    envelope: {
      id: toEventId(`sandbox-event-${seq}`),
      seq,
      threadId: CLOUD_THREAD,
      runId: toRunId('sandbox-run'),
      depth: 0,
      at: '2026-10-02T00:00:00.000Z',
    },
  })

const rig = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-park-files-'))
  homes.push(home)
  const log = new JsonlEventLog(home, registryFor({ home }), new SystemClock(), new RandomIds())
  return { home, log, files: localTranscriptFiles({ home: () => home }) }
}

describe('the local events file at park time', () => {
  it('holds the sandbox events verbatim, so the digest over the file is the checkpoint digest', async () => {
    const { log, files } = await rig()
    await log.append({ threadId: CLOUD_THREAD, runId: toRunId('local'), drafts: [{ type: 'user-said', text: 'said 1' }] })
    const remote = [eventAt(1), eventAt(2), eventAt(3)]

    const swap = await files.swap({ threadId: CLOUD_THREAD, events: remote })
    await swap.seal()
    await log.refresh({ threadId: CLOUD_THREAD })
    const read = await log.read({ threadId: CLOUD_THREAD })

    expect(read.map((event) => event.id)).toEqual(remote.map((event) => event.id))
    expect(transcriptIdentityDigest(read)).toBe(transcriptIdentityDigest(remote))
    expect(await log.head({ threadId: CLOUD_THREAD })).toBe(3)
  })

  it('puts the local events back when the swap is reverted', async () => {
    const { log, files } = await rig()
    const [local] = await log.append({ threadId: CLOUD_THREAD, runId: toRunId('local'), drafts: [{ type: 'user-said', text: 'said 1' }] })

    const swap = await files.swap({ threadId: CLOUD_THREAD, events: [eventAt(1), eventAt(2)] })
    await swap.revert()
    await log.refresh({ threadId: CLOUD_THREAD })

    expect((await log.read({ threadId: CLOUD_THREAD })).map((event) => event.id)).toEqual(local === undefined ? [] : [local.id])
  })
})
