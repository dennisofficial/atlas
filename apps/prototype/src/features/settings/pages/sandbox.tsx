import { PauseIcon, PlayIcon } from 'lucide-react'

import {
  PAUSED_SANDBOXES,
  RUNNING_SANDBOXES,
  type SandboxRow,
} from '../fixtures/settings-usage-rows'
import { SandboxEmpty } from '../parts/sandbox-empty'
import { SandboxTable } from '../parts/sandbox-table'
import { VercelCredentialCard, type VercelCredentialView } from '../parts/vercel-credential-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

export type SandboxVercelState = {
  view?: VercelCredentialView
  statusLine?: string
}

export const VERCEL_NOT_CONFIGURED: SandboxVercelState = { statusLine: 'Not configured' }

export const VERCEL_CONFIGURED: SandboxVercelState = {
  view: {
    configured: true,
    tokenHint: 'vcp_…a91f',
    teamId: 'team_dennis',
    vercelProjectId: 'prj_atlas_sandboxes',
    updatedAt: '2026-10-21T09:00:00.000Z',
  },
  statusLine: 'Configured · updated 3h ago',
}

export function SandboxPage({
  vercel = VERCEL_CONFIGURED,
  running = RUNNING_SANDBOXES,
  paused = PAUSED_SANDBOXES,
}: {
  vercel?: SandboxVercelState
  running?: SandboxRow[]
  paused?: SandboxRow[]
}) {
  return (
    <SettingsPage
      title="Sandbox"
      description="Atlas Cloud runs your threads in sandboxes on your own Vercel account."
    >
      <VercelCredentialCard {...vercel} />
      <SettingsSection title="Running" count={running.length}>
        {running.length === 0 ? (
          <SandboxEmpty />
        ) : (
          <SandboxTable rows={running} actionLabel="Pause" actionIcon={<PauseIcon />} />
        )}
      </SettingsSection>
      {paused.length === 0 ? null : (
        <SettingsSection title="Paused" count={paused.length}>
          <SandboxTable rows={paused} actionLabel="Resume" actionIcon={<PlayIcon />} />
        </SettingsSection>
      )}
      <p className="text-xs text-muted-foreground">
        Sandboxes pause after a few idle minutes and resume when you open the thread.
      </p>
    </SettingsPage>
  )
}
