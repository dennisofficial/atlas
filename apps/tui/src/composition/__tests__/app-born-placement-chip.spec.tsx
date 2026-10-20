import { ERunner, ESettingId } from '@dltech/atlas-core'
import { afterEach, describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { CLOUD_NOT_CONFIGURED_NOTICE } from '../cloud/born-cloud'
import { until } from './app-fixture'
import { bornThreadApp, mountUnborn } from './born-thread-fixture'

await grammarsReady()

afterEach(() => dismissNotice())

describe('the placement chip in the composer footer', () => {
  it('starts on the remembered runner', async () => {
    const app = bornThreadApp({ vercel: true })
    app.settings.set({ id: ESettingId.LastBornPlacement, value: ERunner.Vercel })
    const mounted = await mountUnborn({ app })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('☁ cloud ▾'))).toBe(true)
      expect(mounted.bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('explains the refusal and keeps the pod preference when Vercel is chosen without a Vercel token', async () => {
    const app = bornThreadApp({})
    const mounted = await mountUnborn({ app })

    try {
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)

      await mounted.flipChip()

      const noticed = await until({
        holds: async () => currentNotices().some((notice) => notice.text === CLOUD_NOT_CONFIGURED_NOTICE),
        within: 20_000,
      })
      expect(noticed).toBe(true)
      expect(await mounted.frameHolds((frame) => frame.includes('pod ▾'))).toBe(true)
      expect(app.settings.snapshot().document.values[ESettingId.LastBornPlacement]).toBeUndefined()
      expect(mounted.bridge.created.length).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('births a pod on the first send without any notice on a machine without a Vercel token', async () => {
    const mounted = await mountUnborn({ app: bornThreadApp({}) })

    try {
      await mounted.command('no vercel here')

      expect(await until({ holds: async () => mounted.bridge.created.length === 1, within: 20_000 })).toBe(true)
      expect(currentNotices().map((notice) => notice.text)).not.toContain(CLOUD_NOT_CONFIGURED_NOTICE)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
