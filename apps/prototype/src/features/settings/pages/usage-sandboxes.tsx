import { PauseIcon, PlayIcon } from 'lucide-react'

import {
  PAUSED_SANDBOXES,
  RUNNING_SANDBOXES,
  type SandboxRow,
} from '../fixtures/settings-usage-rows'
import { SandboxEmpty } from '../parts/sandbox-empty'
import { SandboxTable } from '../parts/sandbox-table'
import { SettingsPage, SettingsSection } from '../settings-layout'

export function UsageSandboxesPage({
  running = RUNNING_SANDBOXES,
  paused = PAUSED_SANDBOXES,
}: {
  running?: SandboxRow[]
  paused?: SandboxRow[]
}) {
  return (
    <SettingsPage title="Sandboxes" description="Cloud sandboxes your threads are running on.">
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
