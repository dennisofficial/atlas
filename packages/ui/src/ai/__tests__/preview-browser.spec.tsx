import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { deviceSummaryOf } from '../internal/preview-device-menu'
import {
  EViewportKind,
  FULL_VIEWPORT,
  PreviewBrowser,
  type PreviewBrowserProps,
  type PreviewBrowserTab,
  type Viewport,
} from '../preview-browser'
import { PreviewNewTab, PreviewOffline } from '../preview-new-tab'
import { EPreviewStatus, type PreviewPort } from '../preview-ports'

const noop = () => undefined

const TABS: PreviewBrowserTab[] = [
  {
    id: 'a',
    title: 'Web app',
    url: 'https://3000-abc1234567.byatlas.dev',
    status: EPreviewStatus.Live,
  },
  { id: 'b', title: 'New tab', url: '' },
]

const PORT: PreviewPort = {
  id: 'web',
  port: 3000,
  label: 'Web app',
  url: 'https://3000-abc1234567.byatlas.dev',
  status: EPreviewStatus.Starting,
}

const BASE: PreviewBrowserProps = {
  tabs: TABS,
  activeId: 'a',
  onActivate: noop,
  onClose: noop,
  onOpen: noop,
  address: 'https://3000-abc1234567.byatlas.dev',
  canGoBack: true,
  canGoForward: false,
  canReload: true,
  onBack: noop,
  onForward: noop,
  onReload: noop,
  onAddress: noop,
  viewport: FULL_VIEWPORT,
  onViewportChange: noop,
  children: <p>page body</p>,
}

const render = (overrides: Partial<PreviewBrowserProps> = {}) =>
  renderToStaticMarkup(<PreviewBrowser {...BASE} {...overrides} />)

function buttonTag({ html, label }: { html: string; label: string }): string {
  const match = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)
  return match?.[0] ?? ''
}

const TABLET: Viewport = { kind: EViewportKind.Fixed, width: 768, height: 1024 }

describe('PreviewBrowser', () => {
  it('renders every tab title with aria-selected on the active one', () => {
    const html = render()
    expect(html).toContain('Web app')
    expect(html).toContain('New tab')
    expect(html).toMatch(/aria-selected="true"[^>]*title="https:\/\/3000/)
    expect(html.match(/aria-selected="false"/g)).toHaveLength(1)
  })

  it('wraps children in the stage content slot', () => {
    const html = render()
    expect(html).toContain('data-slot="preview-stage-content"')
    expect(html).toContain('page body')
  })

  it('shows the address and links it open in a new tab', () => {
    const html = render()
    expect(html).toContain('value="https://3000-abc1234567.byatlas.dev"')
    expect(html).toContain('href="https://3000-abc1234567.byatlas.dev"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  it('hides open-externally on the new-tab page', () => {
    const html = render({ activeId: 'b', address: '' })
    expect(html).not.toContain('aria-label="Open in your browser"')
  })

  it('disables back, forward and reload from the flags', () => {
    const off = render({ canGoBack: false, canGoForward: false, canReload: false })
    const on = render({ canGoBack: true, canGoForward: true, canReload: true })
    for (const label of ['Back', 'Forward', 'Reload']) {
      expect(buttonTag({ html: off, label })).toContain(' disabled=""')
      expect(buttonTag({ html: on, label })).not.toContain(' disabled=""')
    }
  })

  it('scales the device box to fit the stage', () => {
    const html = render({ viewport: TABLET })
    expect(html).toContain('width:768px;height:1024px;transform:scale(')
  })
})

describe('deviceSummaryOf', () => {
  const fit = { width: 768, height: 1024, scale: 0.5 }

  it('is empty for full, W×H when unscaled, with zoom when scaled', () => {
    expect(deviceSummaryOf({ viewport: FULL_VIEWPORT, fit })).toBe('')
    expect(deviceSummaryOf({ viewport: TABLET, fit: { ...fit, scale: 1 } })).toBe('768×1024')
    expect(deviceSummaryOf({ viewport: TABLET, fit })).toBe('768×1024 · 50%')
  })
})

describe('PreviewNewTab', () => {
  it('lists ports with status and the address hint', () => {
    const html = renderToStaticMarkup(<PreviewNewTab ports={[PORT]} onOpen={noop} />)
    expect(html).toContain('Web app')
    expect(html).toContain('Starting')
    expect(html).toContain(':3000')
    expect(html).toContain('address bar')
  })

  it('says so when no ports are exposed', () => {
    expect(renderToStaticMarkup(<PreviewNewTab ports={[]} onOpen={noop} />)).toContain('No ports')
  })
})

describe('PreviewOffline', () => {
  it('distinguishes starting from stopped', () => {
    expect(renderToStaticMarkup(<PreviewOffline port={PORT} />)).toContain('Waiting for port 3000')
    const stopped = { ...PORT, status: EPreviewStatus.Stopped }
    expect(renderToStaticMarkup(<PreviewOffline port={stopped} />)).toContain(
      'Nothing is listening on port 3000',
    )
  })
})
