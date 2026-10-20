import { ERunner, ESettingId } from '@dltech/atlas-core'
import { afterEach, describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { SIGN_IN_TO_BIRTH_NOTICE } from '../cloud/born-cloud'
import { until } from './app-fixture'
import { bornThreadApp, mountUnborn, type MountedUnborn } from './born-thread-fixture'
import type { FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => dismissNotice())

const lastChoice = (app: FakeApp): unknown => app.settings.snapshot().document.values[ESettingId.LastBornPlacement]

const delivered = (mounted: MountedUnborn, text: string): Promise<boolean> =>
  until({
    holds: async () => mounted.bridge.created.length > 0 && mounted.bridge.channel.sent.some((said) => said.text === text),
    within: 20_000,
  })

describe('a thread before its first send', () => {
  it('births nothing on a plain launch and offers the pod preference', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({}) })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      expect(mounted.bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('flips only the stored preference when the chip is toggled, touching no bridge', async () => {
    const app = bornThreadApp({ vercel: true })
    const mounted = await mountUnborn({ app })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      await mounted.flipChip()

      expect(await mounted.frameHolds((frame) => frame.includes('☁ cloud ▾'))).toBe(true)
      expect(lastChoice(app)).toBe(ERunner.Vercel)
      expect(mounted.bridge.created.length).toBe(0)
      expect(mounted.bridge.destroyed.length).toBe(0)

      await mounted.flipChip()
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      expect(lastChoice(app)).toBe(ERunner.Local)
      expect(mounted.bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('makes no create call on /new until the first send', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({}) })

    try {
      await mounted.command('/new')
      await mounted.command('/new')

      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      expect(mounted.bridge.created.length).toBe(0)

      await mounted.command('now begin')
      expect(await delivered(mounted, 'now begin')).toBe(true)
      expect(mounted.bridge.created.length).toBe(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('the first send', () => {
  it('births a pod and delivers the message to it', async () => {
    const app = bornThreadApp({})
    const mounted = await mountUnborn({ app })

    try {
      const threadId = app.sessionOwner.snapshot().threadId
      await mounted.command('hello, pod')

      expect(await delivered(mounted, 'hello, pod')).toBe(true)
      expect(mounted.bridge.created.map((born) => born.threadId)).toEqual([threadId!])
      expect(app.threads.chosenRunners).toContainEqual({ threadId: threadId!, runner: ERunner.Local })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births on the runner the chip was toggled to', async () => {
    const app = bornThreadApp({ vercel: true })
    const mounted = await mountUnborn({ app })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      await mounted.flipChip()
      expect(await mounted.frameHolds((frame) => frame.includes('☁ cloud ▾'))).toBe(true)

      await mounted.command('ship it')

      expect(await delivered(mounted, 'ship it')).toBe(true)
      const threadId = mounted.bridge.created[0]?.threadId
      expect(app.threads.chosenRunners).toContainEqual({ threadId: threadId!, runner: ERunner.Vercel })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the draft when the sign-in gate refuses, and births nothing', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({ signedOut: true }) })

    try {
      await mounted.command('signed out words')

      const noticed = await until({
        holds: async () => currentNotices().some((notice) => notice.text === SIGN_IN_TO_BIRTH_NOTICE),
        within: 20_000,
      })
      expect(noticed).toBe(true)
      expect(await until({ holds: async () => mounted.draft() === 'signed out words', within: 20_000 })).toBe(true)
      expect(mounted.bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the draft when the preflight refuses, and the next send retries', async () => {
    const preflight = { refusal: "Docker isn't answering — start Docker Desktop" as string | null }
    const mounted = await mountUnborn({ app: bornThreadApp({}), preflight })

    try {
      await mounted.command('try the pod')

      expect(await until({ holds: async () => mounted.draft() === 'try the pod', within: 20_000 })).toBe(true)
      expect(currentNotices().some((notice) => notice.text.includes('Docker Desktop'))).toBe(true)
      expect(mounted.bridge.created.length).toBe(0)

      preflight.refusal = null
      dismissNotice()
      await mounted.frame()
      expect(await mounted.frameHolds((frame) => frame.includes('try the pod'))).toBe(true)
      await mounted.command('')

      expect(await delivered(mounted, 'try the pod')).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('fixes the runner once born: the chip no longer flips', async () => {
    const app = bornThreadApp({ vercel: true })
    const mounted = await mountUnborn({ app })

    try {
      await mounted.command('born now')
      expect(await delivered(mounted, 'born now')).toBe(true)
      const before = lastChoice(app)

      await mounted.flipChip()
      const frame = await mounted.frame()

      expect(frame).not.toContain('pod ▾')
      expect(frame).not.toContain('☁ cloud ▾')
      expect(lastChoice(app)).toBe(before)
      expect(mounted.bridge.created.length).toBe(1)
      expect(mounted.bridge.destroyed.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
