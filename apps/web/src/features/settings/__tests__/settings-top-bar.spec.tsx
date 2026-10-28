import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SettingsTopBar } from '../settings-top-bar'

describe('SettingsTopBar', () => {
  it('shows a plain Settings title and no scope tabs', () => {
    const html = renderToStaticMarkup(<SettingsTopBar />)
    expect(html).toContain('>Settings<')
    expect(html).toContain('Back to Atlas')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('Personal')
  })
})
