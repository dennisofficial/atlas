import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { RunFailureBanner } from '../run-failure-banner'

describe('RunFailureBanner', () => {
  it('renders title, detail and an enabled retry', () => {
    const html = renderToStaticMarkup(
      <RunFailureBanner title="Rate limited" detail="Wait a moment" onRetry={() => {}} />,
    )

    expect(html).toContain('Rate limited')
    expect(html).toContain('Wait a moment')
    expect(html).toContain('Retry')
    expect(html).not.toContain(' disabled=""')
    expect(html).not.toContain('<a ')
  })

  it('disables retry while busy', () => {
    const html = renderToStaticMarkup(
      <RunFailureBanner title="t" detail="d" onRetry={() => {}} retryDisabled />,
    )

    expect(html).toContain(' disabled=""')
  })

  it('renders a settings anchor by default', () => {
    const html = renderToStaticMarkup(
      <RunFailureBanner
        title="t"
        detail="d"
        settingsHref="/settings/providers"
        settingsLabel="Open Providers settings"
      />,
    )

    expect(html).toContain('href="/settings/providers"')
    expect(html).toContain('Open Providers settings')
    expect(html).not.toContain('Retry')
  })

  it('lets the host render the link', () => {
    const html = renderToStaticMarkup(
      <RunFailureBanner
        title="t"
        detail="d"
        settingsHref="/x"
        renderLink={({ href, children }) => <span data-to={href}>{children}</span>}
      />,
    )

    expect(html).toContain('data-to="/x"')
  })
})
