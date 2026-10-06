import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { PlacementController } from '../../../composition/placement-controller'
import { cloudArchiveOf, descend, fakeSurface, useDescendHome } from './descend-fixture'
import { sessionDirBytes } from './descend-preserve-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const transcriptBytes = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(sessionDirBytes({ home: process.env['ATLAS_HOME'] ?? '' })).filter(([file]) =>
      file.endsWith('.events.jsonl'),
    ),
  )

const interruptions = [
  ['the connection is interrupted mid-download', new Error('connection interrupted after 4096 bytes')],
  ['the downloaded bytes fail the checksum', new Error('the session archive checksum does not match the export')],
] as const

describe('a session download that fails during descend', () => {
  for (const [name, failure] of interruptions) {
    it(`keeps the local data and the cloud owner when ${name}`, async () => {
      const home = useDescendHome()
      await home.threads.createWithFirstEvents({
        threadId: CLOUD_THREAD,
        runId: home.ids.nextRunId(),
        executionLocation: EExecutionLocation.Cloud,
        drafts: [said('old local words')],
        workspace: '/work',
      })
      const placement = new PlacementController(EExecutionLocation.Cloud)
      placement.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
      await placement.activate({ threadId: CLOUD_THREAD })
      const archive = await cloudArchiveOf([{ drafts: [said('cloud words')] }])
      const bridge = fakeBridge({ archive, downloadSessionFails: failure })
      const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
      const surface = fakeSurface()
      let localOpens = 0
      surface.surface.openLocal = async (_home, threadId) => {
        localOpens += 1
        return { threadId }
      }
      const before = transcriptBytes()

      await expect(descend({ home, bridge, channel, surface, placement })).rejects.toThrow(failure.message)

      expect(transcriptBytes()).toEqual(before)
      const texts = (await home.log.read({ threadId: CLOUD_THREAD })).map(
        (event) => (event as { text?: string }).text,
      )
      expect(texts).toEqual(['old local words'])
      expect(localOpens).toBe(0)
      expect(placement.current()).toBe(EExecutionLocation.Cloud)
      expect(placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
      expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
        EExecutionLocation.Cloud,
      )
      expect(bridge.destroyed).toEqual([])
      expect(channel.paused).toBe(false)
    })
  }
})
