import { PauseIcon, PlayIcon, RefreshCwIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import {
  PAUSED_SANDBOXES,
  RUNNING_SANDBOXES,
  type SandboxRow,
} from '../../../fixtures/settings-usage'
import { UsageSandboxEmpty } from '../parts/usage-sandbox-empty'
import { UsageSandboxTable } from '../parts/usage-sandbox-table'
import { SettingsPage, SettingsSection } from '../settings-layout'

export function UsageSandboxesView({
  running,
  paused,
}: {
  running: SandboxRow[]
  paused: SandboxRow[]
}) {
  return (
    <SettingsPage
      title="Usage: Sandboxes"
      description="Cloud sandboxes your threads are running on."
      actions={
        <>
          <span className="text-sm text-muted-foreground">Last refreshed 2 min ago</span>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh">
            <RefreshCwIcon />
          </Button>
        </>
      }
    >
      <SettingsSection title={`Currently running (${running.length})`}>
        {running.length === 0 ? (
          <UsageSandboxEmpty />
        ) : (
          <UsageSandboxTable rows={running} actionLabel="Pause" actionIcon={<PauseIcon />} />
        )}
      </SettingsSection>
      <SettingsSection title={`Recently paused (${paused.length})`}>
        <UsageSandboxTable rows={paused} actionLabel="Resume" actionIcon={<PlayIcon />} />
      </SettingsSection>
      <p className="text-xs text-muted-foreground">
        Sandboxes are billed by the minute while running and pause automatically when idle.
      </p>
    </SettingsPage>
  )
}

export function UsageSandboxesPage() {
  return <UsageSandboxesView running={RUNNING_SANDBOXES} paused={PAUSED_SANDBOXES} />
}
