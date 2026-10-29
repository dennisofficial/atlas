import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { NamingTitle } from '../naming-title'

describe('NamingTitle', () => {
  it('announces naming and hides the noise while generating', () => {
    const html = renderToStaticMarkup(<NamingTitle title={null} naming />)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Naming thread')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('font-mono')
    expect(html).toContain('aria-live="polite"')
  })

  it('renders a title set from the start plainly', () => {
    const html = renderToStaticMarkup(<NamingTitle title="Fix the bug" naming={false} />)

    expect(html).toContain('Fix the bug')
    expect(html).toContain('truncate')
    expect(html).not.toContain('Naming thread')
  })

  it('falls back when untitled and not naming', () => {
    expect(renderToStaticMarkup(<NamingTitle title={null} naming={false} />)).toContain(
      'Untitled thread',
    )
    expect(
      renderToStaticMarkup(<NamingTitle title={null} naming={false} fallback="New" />),
    ).toContain('New')
  })
})
