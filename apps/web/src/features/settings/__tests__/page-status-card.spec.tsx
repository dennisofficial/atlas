import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPageStatus } from '../status/page-status'
import { PageStatusCard } from '../status/page-status-card'

describe('PageStatusCard', () => {
  it('renders nothing for live pages', () => {
    expect(renderToStaticMarkup(<PageStatusCard status={EPageStatus.Live} />)).toBe('')
  })

  it('explains preview-only pages', () => {
    const html = renderToStaticMarkup(<PageStatusCard status={EPageStatus.Mock} />)
    expect(html).toContain('Preview only')
    expect(html).toContain('aren&#x27;t hooked up to Atlas Cloud yet')
  })

  it('explains stored pages and shows detail', () => {
    const html = renderToStaticMarkup(
      <PageStatusCard status={EPageStatus.Stored} detail="Only the theme is saved." />,
    )
    expect(html).toContain('Saved to Atlas Cloud')
    expect(html).toContain('Only the theme is saved.')
  })

  it('offers a dismiss button only when given a handler', () => {
    const without = renderToStaticMarkup(<PageStatusCard status={EPageStatus.Mock} />)
    const withHandler = renderToStaticMarkup(
      <PageStatusCard status={EPageStatus.Mock} onDismiss={() => undefined} />,
    )
    expect(without).not.toContain('aria-label="Dismiss"')
    expect(withHandler).toContain('aria-label="Dismiss"')
  })
})
