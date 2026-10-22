import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EVercelCredentialGap } from '@dltech/atlas-wire/web'

import { hrefOfPage, ESettingsPage } from '@/features/settings/settings-nav'

import { NotConfiguredAlert } from '../not-configured-alert'

const render = (gap?: EVercelCredentialGap) =>
  renderToStaticMarkup(<NotConfiguredAlert error="Add a Vercel token." gap={gap} />)

describe('NotConfiguredAlert', () => {
  it('links a missing personal credential to the personal Secrets page', () => {
    const html = render(EVercelCredentialGap.UserCredential)
    expect(html).toContain(`href="${hrefOfPage(ESettingsPage.Secrets)}"`)
    expect(html).toContain('Open your settings')
    expect(html).not.toContain(hrefOfPage(ESettingsPage.WorkspaceSecrets))
  })

  it.each([EVercelCredentialGap.WorkspaceCredential, EVercelCredentialGap.CredentialProjectId])(
    'links %s to the workspace Secrets page',
    (gap) => {
      const html = render(gap)
      expect(html).toContain(`href="${hrefOfPage(ESettingsPage.WorkspaceSecrets)}"`)
      expect(html).toContain('Open workspace settings')
    },
  )

  it('keeps the workspace link when the API names no gap', () => {
    const html = render()
    expect(html).toContain(`href="${hrefOfPage(ESettingsPage.WorkspaceSecrets)}"`)
    expect(html).toContain('Add a Vercel token.')
  })
})
