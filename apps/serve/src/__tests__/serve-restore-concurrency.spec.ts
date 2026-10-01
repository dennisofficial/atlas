import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-harness'

import { fakeServeApp } from './fakes'
import {
  askRestore,
  bootRestoreServe,
  freshRestoreHome,
  RESTORE_THREAD,
  seedArchive,
  settle,
  wireRealLog,
} from './restore-fixture'

describe('restore-transcript against live work', () => {
  it('fails the op when the drive never got the archive, even with a log on disk', async () => {
    const home = freshRestoreHome()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    const { client } = await bootRestoreServe({ home, archive: async () => null, app })

    const reply = await askRestore(client, 'restore-none')
    expect(reply.ok).toBe(false)
    expect(reply.message).toContain('no transcript archive')
  })

  it('refuses the restore while a turn is running, then accepts it once the turn settles', async () => {
    const home = freshRestoreHome()
    const archive = await seedArchive({ texts: ['one'] })
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const app = fakeServeApp({
      threadId: RESTORE_THREAD,
      root: '/workspace',
      intake: true,
      holdStep: async () => {
        await held
      },
    })

    const { client } = await bootRestoreServe({ home, archive: async () => archive, app })
    client.send({ kind: EClientFrame.Send, sendId: 'busy-send' as never, text: 'hold the turn' })
    await client.waitFor(
      (frame) => frame.kind === EServeFrame.Signal && frame.signal.type === 'step-started',
    )

    const busy = await askRestore(client, 'restore-busy')
    expect(busy.ok).toBe(false)
    expect(busy.message).toContain('turn is running')

    release?.()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    const quiet = await askRestore(client, 'restore-quiet')
    expect(quiet.ok).toBe(true)
  })

  it('shares one in-flight restore between concurrent ops', async () => {
    const home = freshRestoreHome()
    const archive = await seedArchive({ texts: ['one'] })
    let fetches = 0
    let releaseFetch: (() => void) | undefined
    let heldFetch: Promise<void> = Promise.resolve()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    const { client } = await bootRestoreServe({
      home,
      archive: async () => {
        fetches += 1
        await heldFetch
        return archive
      },
      app,
    })
    const fetchesAtBoot = fetches
    heldFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })

    client.send({ kind: EClientFrame.Request, id: 'restore-a', op: EClientRequest.RestoreTranscript, params: {} })
    client.send({ kind: EClientFrame.Request, id: 'restore-b', op: EClientRequest.RestoreTranscript, params: {} })
    await settle()
    expect(fetches).toBe(fetchesAtBoot + 1)
    releaseFetch?.()
    const a = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'restore-a')
    const b = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'restore-b')
    if (a.kind !== EServeFrame.Reply || b.kind !== EServeFrame.Reply) throw new Error('expected replies')
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(fetches).toBe(fetchesAtBoot + 1)
  })

  it('holds a send behind an in-flight restore and delivers it after', async () => {
    const home = freshRestoreHome()
    const archive = await seedArchive({ texts: ['one'] })
    let releaseFetch: (() => void) | undefined
    let heldFetch: Promise<void> = Promise.resolve()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    const { client } = await bootRestoreServe({
      home,
      archive: async () => {
        await heldFetch
        return archive
      },
      app,
    })
    heldFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })

    client.send({ kind: EClientFrame.Request, id: 'restore-hold', op: EClientRequest.RestoreTranscript, params: {} })
    await settle()
    client.send({ kind: EClientFrame.Send, sendId: 'held-send' as never, text: 'queued behind the restore' })

    const impatientAck = Promise.race([
      client.waitFor((frame) => frame.kind === EServeFrame.SendAcked && frame.sendId === 'held-send'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
    ])
    expect(await impatientAck).toBeNull()

    releaseFetch?.()
    await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'restore-hold')
    const ack = await client.waitFor(
      (frame) => frame.kind === EServeFrame.SendAcked && frame.sendId === 'held-send',
    )
    expect(ack.kind).toBe(EServeFrame.SendAcked)
  })

  it('surfaces a failed restore to the frames held behind it', async () => {
    const home = freshRestoreHome()
    let releaseFetch: (() => void) | undefined
    let heldFetch: Promise<void> = Promise.resolve()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })

    const { client } = await bootRestoreServe({
      home,
      archive: async () => {
        await heldFetch
        return null
      },
      app,
    })
    heldFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })

    client.send({ kind: EClientFrame.Request, id: 'restore-fail', op: EClientRequest.RestoreTranscript, params: {} })
    client.send({ kind: EClientFrame.Send, sendId: 'doomed-send' as never, text: 'behind a failing restore' })

    releaseFetch?.()
    const refusal = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'restore-fail' && !frame.ok,
    )
    expect(refusal.kind).toBe(EServeFrame.Reply)

    const surfaced = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Error && frame.message.includes('the transcript restore failed'),
    )
    expect(surfaced.kind).toBe(EServeFrame.Error)
  })
})
