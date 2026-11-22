import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PLATFORM_NOT_CONFIGURED } from '../data/not-configured'
import { NotConfiguredAlert } from '../not-configured-alert'

describe('NotConfiguredAlert', () => {
  it('says the deployment is not configured and sends nobody to a credential setting', () => {
    const html = renderToStaticMarkup(<NotConfiguredAlert error={PLATFORM_NOT_CONFIGURED} />)
    expect(html).toContain(PLATFORM_NOT_CONFIGURED)
    expect(html).not.toContain('href=')
    expect(html).not.toContain('Vercel')
  })
})
