import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { NotifyDeviceView } from '@dltech/atlas-wire/web'

import { notifyApiFake } from '../../../sessions/data/__tests__/notify-api.fake'

const setNotifyDeviceEnabled = mock(async () => undefined)
const devices: NotifyDeviceView[] = [
  {
    id: 'device-1',
    kind: 'web-push',
    label: 'Firefox on macOS',
    enabled: false,
    lastSeenAt: '2026-11-23T14:00:00.000Z',
  },
  {
    id: 'device-2',
    kind: 'apns-mac',
    label: 'Dennis’s Mac',
    enabled: true,
    lastSeenAt: '2026-11-23T14:00:00.000Z',
  },
]

mock.module('../../../sessions/data/notify-api', () => ({
  ...notifyApiFake,
  listNotifyDevices: async () => ({ devices }),
  setNotifyDeviceEnabled,
}))

const { NotifyDevicesCard } = await import('../notify-devices-card')

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  setNotifyDeviceEnabled.mockClear()
})

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const renderCard = async (): Promise<void> => {
  const { createRoot } = await import('react-dom/client')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => {
    mounted.render(
      <QueryClientProvider client={client}>
        <NotifyDevicesCard />
      </QueryClientProvider>,
    )
  })
  await settle()
}

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('NotifyDevicesCard', () => {
  it('lists every device with its surface', async () => {
    await renderCard()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Firefox on macOS')
    expect(text).toContain('Web, Off')
    expect(text).toContain('Dennis’s Mac')
    expect(text).toContain('Mac, On')
  })

  it('shows a paused device as off and turns it back on', async () => {
    await renderCard()
    const toggle = document.querySelector('[aria-label="Firefox on macOS notifications"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    await click(toggle)
    expect(setNotifyDeviceEnabled).toHaveBeenCalledWith({ deviceId: 'device-1', enabled: true })
  })
})
