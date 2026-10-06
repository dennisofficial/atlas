import { access } from 'node:fs/promises'

import { describe, expect, it } from 'bun:test'

import { CloudError } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { eventsInArchive } from './fake-transcript'
import { CLOUD_THREAD, fakeBridge, type FakeBridge } from './fixture'
import { LOCAL_LOG, harness } from './lift-fixture'
import { liftToCloud } from '../lift'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const capturingUploads = (bridge: FakeBridge): string[] => {
  const captured: string[] = []
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = async (given) => {
    if (given.transcriptArchivePath !== undefined) captured.push(given.transcriptArchivePath)
    return create(given)
  }
  return captured
}

const identitiesOf = (events: readonly { id: string }[]): string[] => events.map((event) => event.id)

describe('the local transcript archive a lift stages', () => {
  it('is removed once the lift succeeds, while the uploaded copy keeps the event identities', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const captured = capturingUploads(bridge)
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(captured).toHaveLength(1)
    const [local] = captured
    const uploaded = bridge.transcriptPuts[0]?.archivePath
    if (local === undefined || uploaded === undefined) throw new Error('the lift uploaded no transcript')
    expect(await exists(local)).toBe(false)
    expect(await exists(uploaded)).toBe(true)
    expect(identitiesOf(await eventsInArchive(uploaded))).toEqual(identitiesOf(LOCAL_LOG))
  })

  it('is removed when the upload fails before the placement commits, and the host keeps the session', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      putTranscriptFails: new CloudError({ status: 500, message: 'the row would not take the tar' }),
    })
    const captured = capturingUploads(bridge)
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    const [local] = captured
    const uploaded = bridge.transcriptPuts[0]?.archivePath
    if (local === undefined || uploaded === undefined) throw new Error('the lift uploaded no transcript')
    expect(await exists(local)).toBe(false)
    expect(await exists(uploaded)).toBe(true)
    expect(identitiesOf(await eventsInArchive(uploaded))).toEqual(identitiesOf(LOCAL_LOG))
  })

  it('is removed when sandbox creation throws after the archive path is captured', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const captured: string[] = []
    bridge.sandboxes.create = async (given) => {
      if (given.transcriptArchivePath !== undefined) captured.push(given.transcriptArchivePath)
      throw new CloudError({ status: 500, message: 'no capacity in iad1' })
    }
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    const [local] = captured
    if (local === undefined) throw new Error('the lift handed over no transcript archive')
    expect(await exists(local)).toBe(false)
  })
})
