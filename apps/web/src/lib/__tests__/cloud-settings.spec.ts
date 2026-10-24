import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { answerTrpc, resetTrpc, restoreTrpc, trpcCalls, trpcData } from '@/lib/__tests__/fake-trpc'

import { ESettingsTarget, fetchSettings, saveSettings } from '../cloud-settings'

beforeEach(resetTrpc)
afterEach(restoreTrpc)

describe('personal settings', () => {
  it('lists through settings.list', async () => {
    answerTrpc(() => trpcData({ settings: [{ key: 'k', value: '"v"', updatedAt: 'x' }] }))
    const values = await fetchSettings({ kind: ESettingsTarget.Personal })
    expect(trpcCalls).toEqual([{ url: '/v1/trpc/settings.list', method: 'GET', body: undefined }])
    expect([...values.keys()]).toEqual(['k'])
  })

  it('patches through settings.patch with encoded values', async () => {
    await saveSettings({
      target: { kind: ESettingsTarget.Personal },
      changes: { a: true, b: null },
    })
    expect(trpcCalls).toHaveLength(1)
    expect(trpcCalls[0]).toMatchObject({ url: '/v1/trpc/settings.patch', method: 'POST' })
    expect(trpcCalls[0]?.body).toMatchObject({ values: { b: null } })
  })

  it('sends nothing for an empty change set', async () => {
    await saveSettings({ target: { kind: ESettingsTarget.Personal }, changes: {} })
    expect(trpcCalls).toEqual([])
  })
})
