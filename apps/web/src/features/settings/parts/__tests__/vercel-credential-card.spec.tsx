import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EVercelCredentialKind, EVercelPlan } from '@dltech/atlas-wire/web'

import {
  EMPTY_VERCEL_VIEW,
  PERSONAL_VERCEL_COPY,
  VercelCredentialCard,
} from '../vercel-credential-card'

const configured = {
  configured: true,
  kind: EVercelCredentialKind.Token as EVercelCredentialKind,
  teamId: 'team_abc',
  vercelProjectId: 'prj_abc',
  plan: EVercelPlan.Unknown as EVercelPlan,
  planCheckedAt: null,
  needsReconnect: false,
  oauthConfigured: false,
  updatedAt: '2026-10-21T09:00:00.000Z' as string | null,
}

describe('VercelCredentialCard', () => {
  it('shows the token field with a Create-a-token link and idle pickers', () => {
    const html = renderToStaticMarkup(<VercelCredentialCard view={configured} />)
    expect(html).toContain('Connected via access token')
    expect(html).toContain('Token saved and hidden')
    expect(html).toContain('Create a token')
    expect(html).toContain('https://vercel.com/account/tokens')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('Paste a token to load your teams')
    expect(html).toContain('Pick a team first')
    expect(html).not.toContain('value="team_abc"')
  })

  it('keeps the manual ID inputs behind a collapsible', () => {
    const html = renderToStaticMarkup(<VercelCredentialCard view={configured} />)
    expect(html).toContain('Enter IDs manually')
    expect(html).not.toContain('placeholder="team_…"')
    expect(html).not.toContain('placeholder="prj_…"')
  })

  it('shows the create-a-token link on the empty card', () => {
    const html = renderToStaticMarkup(<VercelCredentialCard />)
    expect(html).toContain('Create a token')
    expect(html).toContain('Not configured')
  })

  it('offers Connect Vercel when oauth is configured and nothing is connected', () => {
    const html = renderToStaticMarkup(
      <VercelCredentialCard view={{ ...EMPTY_VERCEL_VIEW, oauthConfigured: true }} />,
    )
    expect(html).toContain('Connect Vercel')
    expect(html).toContain('Not configured')
  })

  it('shows the reconnect state and the plan badge for an expired oauth connection', () => {
    const html = renderToStaticMarkup(
      <VercelCredentialCard
        view={{
          ...configured,
          kind: EVercelCredentialKind.Oauth,
          plan: EVercelPlan.Enterprise,
          needsReconnect: true,
          oauthConfigured: true,
        }}
      />,
    )
    expect(html).toContain('Connection expired')
    expect(html).toContain('Reconnect Vercel')
    expect(html).toContain('Enterprise')
    expect(html).toContain('Disconnect')
  })

  it('hides the token form for an oauth connection and offers Refresh plan', () => {
    const html = renderToStaticMarkup(
      <VercelCredentialCard
        view={{
          ...configured,
          kind: EVercelCredentialKind.Oauth,
          plan: EVercelPlan.Pro,
          oauthConfigured: true,
        }}
      />,
    )
    expect(html).toContain('Connected via Vercel')
    expect(html).toContain('Refresh plan')
    expect(html).toContain('Pro')
    expect(html).not.toContain('Use an access token instead')
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
