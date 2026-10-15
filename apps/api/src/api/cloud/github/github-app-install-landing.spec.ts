import { describe, expect, it } from 'vitest'

import { installLandingPage } from './github-app-install-landing'

describe('installLandingPage', () => {
  it('names the org when the installation is known', () => {
    const page = installLandingPage({ accountLogin: 'trycompai' })
    expect(page).toContain('Atlas is installed on trycompai')
    expect(page).toContain('trycompai repositories')
  })

  it('falls back to a generic confirmation when the installation is unknown', () => {
    const page = installLandingPage({ accountLogin: null })
    expect(page).toContain('Atlas is installed')
    expect(page).not.toContain('installed on ')
  })

  it('escapes the org login before embedding it', () => {
    const page = installLandingPage({ accountLogin: '<script>alert(1)</script>' })
    expect(page).not.toContain('<script>')
    expect(page).toContain('&lt;script&gt;')
  })
})
