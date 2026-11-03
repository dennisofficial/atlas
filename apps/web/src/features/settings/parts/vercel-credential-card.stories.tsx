import {
  EVercelCredentialKind,
  EVercelPlan,
  type VercelTokenDiscover,
} from '@dltech/atlas-wire/web'

import type { VercelDiscoverFn } from '../data/shared/vercel-discovery'
import { EMPTY_VERCEL_VIEW, VercelCredentialCard } from './vercel-credential-card'

const meta = {
  title: 'App/Settings/Vercel Credential Card',
  parameters: { layout: 'fullscreen' },
}

export default meta

const frame = (node: React.ReactNode) => (
  <div className="mx-auto max-w-2xl bg-background p-10">{node}</div>
)

const TEAMS: VercelTokenDiscover['teams'] = [
  { id: 'team_compai', slug: 'comp-ai', name: null, plan: EVercelPlan.Enterprise },
  { id: 'team_dltech', slug: 'dl-tech', name: null, plan: EVercelPlan.Hobby },
]

const PROJECTS: VercelTokenDiscover['projects'] = [
  { id: 'prj_atlas', name: 'atlas-web' },
  { id: 'prj_api', name: 'atlas-api' },
]

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

export const PickedFromToken = {
  render: () => {
    const discover: VercelDiscoverFn = async (input) =>
      input.teamId === undefined
        ? { teams: TEAMS, projects: [] }
        : { teams: TEAMS, projects: PROJECTS }
    return frame(
      <VercelCredentialCard
        view={EMPTY_VERCEL_VIEW}
        discover={discover}
        onSave={() => {}}
        onRemove={() => {}}
      />,
    )
  },
}

export const DiscoveryFailed = {
  render: () => {
    const discover: VercelDiscoverFn = async () => {
      throw new Error('Vercel rejected the token: forbidden')
    }
    return frame(
      <VercelCredentialCard view={EMPTY_VERCEL_VIEW} discover={discover} onSave={() => {}} />,
    )
  },
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
