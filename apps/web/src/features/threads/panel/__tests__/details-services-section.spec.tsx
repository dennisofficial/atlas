import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { DeclaredServicesViewWire } from '@dltech/atlas-wire/web'

import type { DeclaredServicesData } from '../../data/use-declared-services'
import { ServicesSection } from '../details/services-section'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mounted: Array<() => void> = []

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
})

const viewOf = (services: unknown[]): DeclaredServicesViewWire =>
  ({ services, rejections: [] }) as unknown as DeclaredServicesViewWire

const dataOf = (view: DeclaredServicesViewWire): DeclaredServicesData => ({
  view,
  busyName: null,
  error: null,
  handleStart: async () => undefined,
  handleStop: async () => undefined,
  handleRestart: async () => undefined,
})

async function mount(args: { view: DeclaredServicesViewWire; onOpenLog: (id: string) => void }) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () =>
    root.render(<ServicesSection data={dataOf(args.view)} onOpenLog={args.onOpenLog} />),
  )
  return container
}

describe('ServicesSection open log', () => {
  it('opens the log of a service with a serviceId', async () => {
    const opened: string[] = []
    const container = await mount({
      view: viewOf([
        { name: 'web', state: 'running', serviceId: 'svc_web', links: [] },
        { name: 'api', state: 'stopped', links: [] },
      ]),
      onOpenLog: (id) => opened.push(id),
    })
    expect(container.querySelector('[aria-label="Open api log"]')).toBeNull()
    const button = container.querySelector('[aria-label="Open web log"]')
    expect(button).not.toBeNull()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(opened).toEqual(['svc_web'])
  })
})
