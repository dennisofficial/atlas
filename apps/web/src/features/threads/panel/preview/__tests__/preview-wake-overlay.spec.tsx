import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EPreviewWait } from '../../../data/preview-browser/preview-wake'
import { PREVIEW_WAKE_DELAY_MS, PreviewWakeOverlay } from '../preview-wake-overlay'

const DELAY = 10
const roots = new Map<Root, HTMLElement>()

async function mountOverlay() {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.set(root, host)
  const show = async (view: ReactNode) => {
    await act(async () => root.render(view))
  }
  const wait = async () => {
    await act(async () => new Promise<void>((done) => setTimeout(done, DELAY * 3)))
  }
  return { host, show, wait }
}

const overlay = (props: { wait: EPreviewWait; loading: boolean }): ReactNode => (
  <PreviewWakeOverlay wait={props.wait} loading={props.loading} delayMs={DELAY} />
)

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  for (const [root, host] of roots) {
    act(() => root.unmount())
    host.remove()
  }
  roots.clear()
})

describe('PreviewWakeOverlay', () => {
  it('says the pod is waking only after the delay', async () => {
    const { host, show, wait } = await mountOverlay()
    await show(overlay({ wait: EPreviewWait.Asleep, loading: true }))
    expect(host.textContent).not.toContain('Waking the pod')
    await wait()
    expect(host.textContent).toContain('Waking the pod…')
    expect(host.querySelector('[role="status"]')).not.toBeNull()
  })

  it('says the preview is loading while the pod is awake and the frame is not up', async () => {
    const { host, show, wait } = await mountOverlay()
    await show(overlay({ wait: EPreviewWait.Waking, loading: true }))
    await wait()
    expect(host.textContent).toContain('Waking the pod…')
    await show(overlay({ wait: EPreviewWait.Awake, loading: true }))
    await wait()
    expect(host.textContent).toContain('Loading the preview…')
  })

  it('stays away for a frame that loads before the delay', async () => {
    const { host, show, wait } = await mountOverlay()
    await show(overlay({ wait: EPreviewWait.Awake, loading: true }))
    await show(overlay({ wait: EPreviewWait.Awake, loading: false }))
    await wait()
    expect(host.textContent).toBe('')
  })

  it('stays away when the pod is asleep and no load is in flight', async () => {
    const { host, show, wait } = await mountOverlay()
    await show(overlay({ wait: EPreviewWait.Asleep, loading: false }))
    await wait()
    expect(host.textContent).toBe('')
  })

  it('stays away when the pod is awake and the frame is up', async () => {
    const { host, show, wait } = await mountOverlay()
    await show(overlay({ wait: EPreviewWait.Awake, loading: false }))
    await wait()
    expect(host.textContent).toBe('')
  })

  it('hides on the frame load of the current load', async () => {
    const { host, show, wait } = await mountOverlay()
    await show(overlay({ wait: EPreviewWait.Awake, loading: true }))
    await wait()
    expect(host.textContent).toContain('Loading the preview…')
    await show(overlay({ wait: EPreviewWait.Awake, loading: false }))
    expect(host.textContent).toBe('')
  })

  it('allows a quarter second for a normal load before it covers the pane', () => {
    expect(PREVIEW_WAKE_DELAY_MS).toBe(400)
  })
})
