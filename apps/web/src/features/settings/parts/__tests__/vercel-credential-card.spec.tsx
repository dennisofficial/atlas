import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PERSONAL_VERCEL_COPY, VercelCredentialCard } from '../vercel-credential-card'

const configured = {
  configured: true,
  teamId: 'team_abc',
  vercelProjectId: 'prj_abc',
  updatedAt: '2026-10-21T09:00:00.000Z',
}

describe('VercelCredentialCard', () => {
  it('shows the saved team and project IDs but never the token', () => {
    const html = renderToStaticMarkup(<VercelCredentialCard view={configured} />)
    expect(html).toContain('value="team_abc"')
    expect(html).toContain('value="prj_abc"')
    expect(html).toContain('Project ID')
    expect(html).toContain('Token saved and hidden')
  })

  it('no longer tells projects to pick their own Vercel project', () => {
    expect(PERSONAL_VERCEL_COPY.description).not.toContain('Project → Sandbox')
  })

  it('renders the sandbox copy by default', () => {
    const html = renderToStaticMarkup(<VercelCredentialCard />)
    expect(html).toContain('creates your sandboxes')
    expect(html).not.toContain('orkspace')
  })

  it('offers Remove only for an editable configured credential', () => {
    expect(renderToStaticMarkup(<VercelCredentialCard view={configured} />)).toContain('Remove')
    expect(renderToStaticMarkup(<VercelCredentialCard view={configured} disabled />)).not.toContain(
      '>Remove<',
    )
  })
})
