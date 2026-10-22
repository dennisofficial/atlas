import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  PERSONAL_VERCEL_COPY,
  VercelCredentialCard,
  WORKSPACE_VERCEL_COPY,
} from '../vercel-credential-card'

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
    for (const copy of [WORKSPACE_VERCEL_COPY, PERSONAL_VERCEL_COPY]) {
      expect(copy.description).not.toContain('Project → Sandbox')
    }
  })

  it('renders the personal copy when asked', () => {
    const html = renderToStaticMarkup(<VercelCredentialCard copy={PERSONAL_VERCEL_COPY} />)
    expect(html).toContain('personal projects')
  })

  it('offers Remove only for an editable configured credential', () => {
    expect(renderToStaticMarkup(<VercelCredentialCard view={configured} />)).toContain('Remove')
    expect(renderToStaticMarkup(<VercelCredentialCard view={configured} disabled />)).not.toContain(
      '>Remove<',
    )
  })
})
