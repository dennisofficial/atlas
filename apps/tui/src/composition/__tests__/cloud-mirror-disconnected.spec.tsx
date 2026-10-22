import { EConnectionView } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'vitest'

import { dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { cloudChannelOf } from '../thread-view-refresh'
import { ASKED, CHILD, mirrored } from './cloud-mirror-fixture'
import { mounted } from './cloud-turn-state-fixture'

await grammarsReady()

const ASKED_TEXT = 'migrate the packages'

const SYNCED_ANSWER = 'The packages are migrated.'

const CHANNEL_DOWN = 'the channel is disconnected'

const FINAL = {
  type: 'assistant-said' as const,
  parts: [{ type: 'text' as const, text: SYNCED_ANSWER }],
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  dismissNotice()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const synced = async () => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
  })
  const rig = await mirrored({ app, seeded: [ASKED, CHILD], hold: false, inFlight: false })
  const screen = await mounted({ app, opened: rig.opened })
  cleanups.push(async () => {
    await screen.done()
    await rig.cleanup()
  })

  rig.sandboxAppends(FINAL)
  rig.wired.ready(false)
  await screen.until((frame) => frame.includes(SYNCED_ANSWER), 'the answer synced into the mirror')

  return { app, rig, screen }
}

const connectionOf = (app: FakeApp): EConnectionView | undefined =>
  cloudChannelOf(app)?.connection().state

const disconnect = (rig: Awaited<ReturnType<typeof synced>>['rig']): void => {
  rig.failIdentity(CHANNEL_DOWN)
  rig.wired.drop()
}

describe('a cloud thread whose channel drops after its mirror synced', () => {
  it('keeps rendering the mirrored transcript while the channel reconnects', async () => {
    const { app, rig, screen } = await synced()
    expect(connectionOf(app)).toBe(EConnectionView.Connected)

    disconnect(rig)
    const frame = await screen.quiet(400)

    expect(connectionOf(app)).toBe(EConnectionView.Reconnecting)
    expect(frame).toContain(ASKED_TEXT)
    expect(frame).toContain(SYNCED_ANSWER)
    expect(frame).not.toContain(CHANNEL_DOWN)
  }, 30_000)

  it('renders the mirrored transcript on a thread opened after the channel was lost', async () => {
    const { app, rig, screen } = await synced()
    await screen.done()

    disconnect(rig)
    const events = await app.log.read({ threadId: rig.opened.threadId })
    const reopened = await mounted({ app, opened: { ...rig.opened, events } })
    cleanups.push(() => reopened.done())
    const frame = await reopened.until(
      (text) => text.includes(ASKED_TEXT) && text.includes(SYNCED_ANSWER),
      'the mirrored transcript with the channel down',
    )

    expect(connectionOf(app)).toBe(EConnectionView.Reconnecting)
    expect(frame).not.toContain(CHANNEL_DOWN)
  }, 30_000)
})
