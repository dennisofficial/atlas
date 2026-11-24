import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { z } from 'zod'

import { encodeSettingValue } from '@dltech/atlas-wire/web'

import { answerTrpc, resetTrpc, restoreTrpc, trpcCalls, trpcData } from './fake-trpc'
import { registerDom, unregisterDom } from './happy-dom-globals'
import { createTestQueryClient, TestQueryProvider } from './query-test-provider'

const { useCloudSettings } = await import('../cloud-settings')
const { EQueryState } = await import('../use-cloud-query')

type Settings = ReturnType<typeof useCloudSettings>

const unmounts: Array<() => void> = []

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(resetTrpc)

afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await act(async () => unmount())
  restoreTrpc()
})

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)))

async function mountSettings(): Promise<{ current: () => Settings }> {
  let latest: Settings | null = null
  function Probe() {
    latest = useCloudSettings()
    return null
  }
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  unmounts.push(() => root.unmount())
  await act(async () =>
    root.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    ),
  )
  await settled()
  return {
    current: () => {
      if (latest === null) throw new Error('probe never rendered')
      return latest
    },
  }
}

const listUrl = '/v1/trpc/settings.list'
const patchUrl = '/v1/trpc/settings.patch'

describe('useCloudSettings', () => {
  it('reads stored values and falls back to the registry for missing keys', async () => {
    answerTrpc(() =>
      trpcData({
        settings: [
          { key: 'web.appearance.showDiffStat', value: encodeSettingValue(false), updatedAt: 'x' },
        ],
      }),
    )
    const settings = await mountSettings()
    const read = (key: string) => settings.current().read({ key, schema: z.boolean() })

    expect(settings.current().query.state).toBe(EQueryState.Ready)
    expect(read('web.appearance.showDiffStat')).toBe(false)
    expect(read('web.notifications.channel.push')).toBe(true)
  })

  it('patches the changes and then reloads the list', async () => {
    answerTrpc(() => trpcData({ settings: [] }))
    const settings = await mountSettings()

    await act(async () => settings.current().save({ 'web.appearance.reduceMotion': true }))
    await settled()

    expect(trpcCalls.map((call) => call.url)).toEqual([listUrl, patchUrl, listUrl])
  })
})
