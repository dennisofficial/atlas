import { EVercelCredentialKind, EVercelPlan } from '@dltech/atlas-wire/web'

import { EMPTY_VERCEL_VIEW, VercelCredentialCard } from './vercel-credential-card'

const meta = {
  title: 'App/Settings/Vercel Credential Card',
  parameters: { layout: 'fullscreen' },
}

export default meta

const frame = (node: React.ReactNode) => (
  <div className="mx-auto max-w-2xl bg-background p-10">{node}</div>
)

export const Unconfigured = {
  render: () =>
    frame(
      <VercelCredentialCard
        view={{ ...EMPTY_VERCEL_VIEW, oauthConfigured: true }}
        actions={{ onConnect: () => {} }}
        onSave={() => {}}
      />,
    ),
}

export const ConnectedEnterprise = {
  render: () =>
    frame(
      <VercelCredentialCard
        view={{
          configured: true,
          kind: EVercelCredentialKind.Oauth,
          teamId: 'team_dltech',
          vercelProjectId: 'prj_atlas',
          plan: EVercelPlan.Enterprise,
          planCheckedAt: '2026-11-03T00:00:00.000Z',
          needsReconnect: false,
          oauthConfigured: true,
          updatedAt: '2026-11-03T00:00:00.000Z',
        }}
        statusLine="Connected via Vercel · updated just now"
        actions={{ onRefreshPlan: () => {} }}
        onRemove={() => {}}
      />,
    ),
}

export const NeedsReconnect = {
  render: () =>
    frame(
      <VercelCredentialCard
        view={{
          configured: true,
          kind: EVercelCredentialKind.Oauth,
          teamId: 'team_dltech',
          vercelProjectId: 'prj_atlas',
          plan: EVercelPlan.Pro,
          planCheckedAt: '2026-11-02T20:00:00.000Z',
          needsReconnect: true,
          oauthConfigured: true,
          updatedAt: '2026-11-02T20:00:00.000Z',
        }}
        actions={{ onConnect: () => {} }}
        onRemove={() => {}}
      />,
    ),
}
