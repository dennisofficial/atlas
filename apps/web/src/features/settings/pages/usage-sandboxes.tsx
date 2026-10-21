'use client'

import { useCallback } from 'react'
import { PauseIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { QueryPage } from '../data/personal/query-boundary'
import { destroySandbox, fetchSandboxes, splitSandboxes } from '../data/personal/sandboxes-api'
import { useSaveAction } from '../data/personal/use-save-action'
import type { SandboxRow } from '../fixtures/settings-usage-rows'
import { UsageSandboxEmpty } from '../parts/usage-sandbox-empty'
import { UsageSandboxTable } from '../parts/usage-sandbox-table'
import { SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Usage: Sandboxes'
const DESCRIPTION = 'Cloud sandboxes your threads are running on.'

export function UsageSandboxesView({
  running,
  paused,
  busy,
  onRefresh,
  onDestroy,
}: {
  running: SandboxRow[]
  paused: SandboxRow[]
  busy: boolean
  onRefresh: () => void
  onDestroy: (threadId: string) => void
}) {
  return (
    <SettingsPage
      title={TITLE}
      description={DESCRIPTION}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
          <RefreshCwIcon />
        </Button>
      }
    >
      <SettingsSection title={`Currently running (${running.length})`}>
        {running.length === 0 ? (
          <UsageSandboxEmpty />
        ) : (
          <UsageSandboxTable
            rows={running}
            actionLabel="Destroy"
            actionIcon={<Trash2Icon />}
            actionDisabled={busy}
            onAction={onDestroy}
          />
        )}
      </SettingsSection>
      {paused.length > 0 ? (
        <SettingsSection title={`Recently paused (${paused.length})`}>
          <UsageSandboxTable
            rows={paused}
            actionLabel="Destroy"
            actionIcon={<PauseIcon />}
            actionDisabled={busy}
            onAction={onDestroy}
          />
        </SettingsSection>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Sandboxes pause automatically when idle. Size and cost per sandbox are not reported yet.
      </p>
    </SettingsPage>
  )
}

export function UsageSandboxesPage() {
  const query = useCloudQuery({ key: 'usage-sandboxes', load: fetchSandboxes })
  const { reload } = query
  const { saving, run } = useSaveAction()
  const handleDestroy = useCallback(
    (threadId: string) =>
      void run({
        work: async () => {
          await destroySandbox(threadId)
          reload()
        },
        success: 'Sandbox destroyed',
      }),
    [run, reload],
  )
  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION} rows={2}>
      {(entries) => {
        const { running, paused } = splitSandboxes({ entries })
        return (
          <UsageSandboxesView
            running={running}
            paused={paused}
            busy={saving}
            onRefresh={reload}
            onDestroy={handleDestroy}
          />
        )
      }}
    </QueryPage>
  )
}
