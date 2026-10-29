import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { hrefOfPage, ESettingsPage } from '@/features/settings/settings-nav'

import { NotConfiguredAlert } from '../not-configured-alert'

describe('NotConfiguredAlert', () => {
  it('links to the Usage & Sandboxes page where the Vercel credential lives', () => {
    const html = renderToStaticMarkup(<NotConfiguredAlert error="Add a Vercel token." />)
    expect(html).toContain(`href="${hrefOfPage(ESettingsPage.UsageSandboxes)}"`)
    expect(html).toContain('Open your settings')
    expect(html).toContain('Add a Vercel token.')
  })
})
