import { describe, expect, it } from 'bun:test'
import { EExecutionLocation, toEventId } from '@dltech/atlas-core'
import { EClientRequest } from '../../channel-wire'
import { PlacementController } from '../../../composition/placement-controller'
import { liftToCloud } from '../lift'
import { useAtlasHome, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('verified transcript ownership handoff', () => {
  it('does not transfer the preparing metadata-only directory of a cloud-first session', async () => {
    const home = useDescendHome()
    const placement = new PlacementController(EExecutionLocation.Host)
    placement.bind({ threads: home.threads, workspace: '/work', repo: '/work' })
    const test = harness({
      started: false,
      localLog: home.log,
      localThreads: home.threads,
      placement,
    })
    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(true)
    expect(test.bridge.transcriptPuts).toHaveLength(0)
    expect(placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
  })
  it('refuses an unsupported restore before moving ownership or opening the remote conversation', async () => {
    useAtlasHome()
    let opened = false
    const test = harness({
      bridge: fakeBridge({ restoreTranscriptRefused: true }),
      open: async () => {
        opened = true
      },
    })
    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(false)
    expect(opened).toBe(false)
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(test.bridge.channel.closed).toBe(true)
  })

  it('refuses a serve that claims restoration but cannot read the original events', async () => {
    useAtlasHome()
    const test = harness()
    test.bridge.log.readOwn = async () => []
    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(false)
    if (lifted.ok) return
    expect(lifted.detail).toContain('transcript')
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
    expect(test.bridge.channel.closed).toBe(true)
  })

  it('rejects an unsuccessful restore reply even if the socket request succeeds', async () => {
    useAtlasHome()
    const test = harness()
    const attach = test.bridge.attach.bind(test.bridge)
    test.bridge.attach = (request) => {
      const attachment = attach(request)
      const ask = attachment.channel.request.bind(attachment.channel)
      attachment.channel.request = async (frame) => {
        if (frame.op === EClientRequest.RestoreTranscript) return { restored: false }
        return ask(frame)
      }
      return attachment
    }
    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(false)
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
  })

  it('rejects unrelated events even if the remote log has the same sequence numbers', async () => {
    useAtlasHome()
    const test = harness()
    const read = test.bridge.log.readOwn.bind(test.bridge.log)
    test.bridge.log.readOwn = async (request) =>
      (await read(request)).map((event) => ({ ...event, id: toEventId(`unrelated-${event.seq}`) }))
    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(false)
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
  })

  it('verifies readable original events while ownership is still local', async () => {
    useAtlasHome()
    const test = harness()
    let verified = false
    const read = test.bridge.log.readOwn.bind(test.bridge.log)
    test.bridge.log.readOwn = async (request) => {
      expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
      verified = true
      return read(request)
    }
    test.args.open = async () => {
      expect(verified).toBe(true)
      expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    }
    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(true)
    expect(verified).toBe(true)
  })
})
