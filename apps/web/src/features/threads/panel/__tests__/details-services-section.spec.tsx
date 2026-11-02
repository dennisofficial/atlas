import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'
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

type MountArgs = {
  view: DeclaredServicesViewWire
  onOpenLog: (id: string) => void
  onOpenPreview?: (id: string) => void
  ports?: PreviewPort[]
}

const portOf = (serviceId: string): PreviewPort => ({
  id: `service:${serviceId}`,
  port: 3000,
  label: serviceId,
  url: 'https://example.test',
  status: EPreviewStatus.Live,
})

async function mount(args: MountArgs) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () =>
    root.render(
      <ServicesSection
        data={dataOf(args.view)}
        onOpenLog={args.onOpenLog}
        preview={{
          ports: args.ports ?? [],
          onOpen: args.onOpenPreview ?? (() => undefined),
        }}
      />,
    ),
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

const click = async (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

describe('ServicesSection open action', () => {
  it('disables Open when the service has no serviceId', async () => {
    const container = await mount({
      view: viewOf([{ name: 'web', type: 'web', state: 'stopped', links: [] }]),
      onOpenLog: () => undefined,
    })
    const button = container.querySelector('[aria-label="Open web"]')
    expect(button).not.toBeNull()
    expect(button?.hasAttribute('disabled')).toBe(true)
  })

  it('opens the preview of a web service that has a preview candidate', async () => {
    const logs: string[] = []
    const previews: string[] = []
    const container = await mount({
      view: viewOf([
        {
          name: 'web',
          type: 'web',
          state: 'running',
          serviceId: 'svc_web',
          links: [],
        },
      ]),
      onOpenLog: (id) => logs.push(id),
      onOpenPreview: (id) => previews.push(id),
      ports: [portOf('svc_web')],
    })
    await click(container.querySelector('[aria-label="Open web"]'))
    expect(previews).toEqual(['svc_web'])
    expect(logs).toEqual([])
  })

  it('opens the log of a web service without a preview candidate', async () => {
    const logs: string[] = []
    const previews: string[] = []
    const container = await mount({
      view: viewOf([
        {
          name: 'web',
          type: 'web',
          state: 'running',
          serviceId: 'svc_web',
          links: [],
        },
      ]),
      onOpenLog: (id) => logs.push(id),
      onOpenPreview: (id) => previews.push(id),
      ports: [portOf('svc_other')],
    })
    await click(container.querySelector('[aria-label="Open web"]'))
    expect(logs).toEqual(['svc_web'])
    expect(previews).toEqual([])
  })

  it('opens the log of api, database and untyped services even with a candidate', async () => {
    const logs: string[] = []
    const previews: string[] = []
    const container = await mount({
      view: viewOf([
        {
          name: 'api',
          type: 'api',
          state: 'running',
          serviceId: 'svc_api',
          links: [],
        },
        {
          name: 'db',
          type: 'database',
          state: 'running',
          serviceId: 'svc_db',
          links: [],
        },
        { name: 'misc', state: 'running', serviceId: 'svc_misc', links: [] },
      ]),
      onOpenLog: (id) => logs.push(id),
      onOpenPreview: (id) => previews.push(id),
      ports: [portOf('svc_api'), portOf('svc_db'), portOf('svc_misc')],
    })
    await click(container.querySelector('[aria-label="Open api"]'))
    await click(container.querySelector('[aria-label="Open db"]'))
    await click(container.querySelector('[aria-label="Open misc"]'))
    expect(logs).toEqual(['svc_api', 'svc_db', 'svc_misc'])
    expect(previews).toEqual([])
  })
})

describe('ServicesSection type icon', () => {
  it('renders a labelled icon per service type and none when untyped', async () => {
    const container = await mount({
      view: viewOf([
        { name: 'web', type: 'web', state: 'running', links: [] },
        { name: 'api', type: 'api', state: 'running', links: [] },
        { name: 'db', type: 'database', state: 'running', links: [] },
        { name: 'misc', state: 'running', links: [] },
      ]),
      onOpenLog: () => undefined,
    })
    const labels = [...container.querySelectorAll('[role="img"]')].map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(labels).toEqual(['web service', 'api service', 'database service'])
  })
})
