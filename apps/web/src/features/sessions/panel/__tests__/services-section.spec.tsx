import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { serviceLogKey } from '../../data/service-log'
import { SessionServicesSection } from '../details/services-section'
import { SessionPaneProvider } from '../pane-value'
import { EPodPowerPhase } from '@dltech/atlas-core'

import { paneValueFixture, previewFixture, serviceRowFixture, statusFixture } from './fixture'

const mounted: Array<() => void> = []

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await act(async () => unmount())
})

const valueOf = (rows = [serviceRowFixture()]) =>
  paneValueFixture({
    view: { ...paneValueFixture().view, serviceRows: rows, previews: [previewFixture] },
  })

const render = (value: ReturnType<typeof valueOf>): string =>
  renderToStaticMarkup(
    <TestQueryProvider client={createTestQueryClient()}>
      <SessionPaneProvider value={value}>
        <SessionServicesSection />
      </SessionPaneProvider>
    </TestQueryProvider>,
  )

async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(() => {
    root.unmount()
    container.remove()
  })
  await act(async () => root.render(node))
  return container
}

const click = async (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

describe('SessionServicesSection', () => {
  it('omits the section when no service is running', () => {
    const html = render(valueOf([]))
    expect(html).toBe('')
  })

  it('lists a service with its port and open link', () => {
    const html = render(valueOf())
    expect(html).toContain('web')
    expect(html).toContain(':4321')
    expect(html).toContain('aria-label="Open web"')
    expect(html).toContain('aria-label="Open the web log"')
  })

  it('uses the first command word for an empty service name', () => {
    const html = render(valueOf([serviceRowFixture({ name: '   ', command: '  bun run dev' })]))
    expect(html).toContain('aria-label="Open the bun log"')
  })

  it('labels an old blank service row with its id', () => {
    const html = render(valueOf([serviceRowFixture({ name: undefined, command: '' })]))
    expect(html).toContain('aria-label="Open the svc-web log"')
  })

  it('swaps actions into the trailing cell for pointer, keyboard and touch', () => {
    const html = render(valueOf())
    expect(html).toContain('data-row-actions')
    expect(html).not.toContain('absolute inset-y-0 right-0')
    expect(html).not.toContain('bg-gradient-to-r')
    expect(html).toContain('group-hover:flex')
    expect(html).toContain('group-focus-within:flex')
    expect(html).toContain('motion-reduce:transition-none')
    expect(html).toContain('[@media(hover:none)]:flex')
  })

  it('marks a running service paused but still offers its preview while the pod is asleep', () => {
    const base = valueOf()
    const html = render({
      ...base,
      status: {
        ...statusFixture,
        pod: { phase: 'steady', power: { phase: EPodPowerPhase.Asleep } },
      },
    })
    expect(html).toContain('paused')
    expect(html).toContain('bg-warning')
    expect(html).not.toContain('data-service-stop')
    expect(html).toContain('aria-label="Open web"')
  })

  it('keeps a running service live while the pod is stopping', () => {
    const html = render({
      ...valueOf(),
      status: {
        ...statusFixture,
        pod: { phase: 'steady', power: { phase: EPodPowerPhase.Stopping } },
      },
    })
    expect(html).not.toContain('paused')
    expect(html).toContain('data-service-stop')
  })

  it('opens a sheet with the service log', async () => {
    const client = createTestQueryClient()
    client.setQueryData(serviceLogKey({ sessionId: 'ses-1', serviceId: 'svc-web' }), {
      text: 'listening on :4321',
      truncated: false,
    })
    const container = await mount(
      <TestQueryProvider client={client}>
        <SessionPaneProvider value={valueOf()}>
          <SessionServicesSection />
        </SessionPaneProvider>
      </TestQueryProvider>,
    )
    await click(container.querySelector('[aria-label="Open the web log"]'))
    expect(document.body.textContent).toContain('bun run dev')
    expect(document.body.textContent).toContain('listening on :4321')
  })

  it('says so when the tail of the log is all that is shown', async () => {
    const client = createTestQueryClient()
    client.setQueryData(serviceLogKey({ sessionId: 'ses-1', serviceId: 'svc-web' }), {
      text: 'the end',
      truncated: true,
    })
    const container = await mount(
      <TestQueryProvider client={client}>
        <SessionPaneProvider value={valueOf()}>
          <SessionServicesSection />
        </SessionPaneProvider>
      </TestQueryProvider>,
    )
    await click(container.querySelector('[aria-label="Open the web log"]'))
    expect(document.body.textContent).toContain('Showing the last 64 KiB.')
  })
})
