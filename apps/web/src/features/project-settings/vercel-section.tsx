'use client'

import { useState } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'

import { QueryGate } from '@/features/settings/data/workspace/query-gate'
import { runAction } from '@/features/settings/data/workspace/run-action'
import { AVAILABLE_SOON, CLOUD_CAPABILITIES } from '@/lib/cloud-capabilities'

import { useProjectVercel } from './data/use-project-vercel'
import { SettingsCard, SettingsRow, SettingsSection, UnsavedHint } from './settings-layout'

const DESCRIPTION =
  "The Vercel project this project's sandboxes are created in. The token and team come from the workspace."

function VercelForm({
  saved,
  disabled,
  onSave,
}: {
  saved: string
  disabled: boolean
  onSave: (value: string) => Promise<boolean>
}) {
  const [value, setValue] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = value.trim() !== saved
  const handleSave = async () => {
    setSaving(true)
    await onSave(value)
    setSaving(false)
  }
  return (
    <SettingsSection
      title="Vercel"
      actions={disabled ? <Badge variant="outline">{AVAILABLE_SOON}</Badge> : null}
    >
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={disabled || !dirty || saving} onClick={() => void handleSave()}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow title="Vercel project ID" htmlFor="sandbox-vercel-project-id" description={DESCRIPTION}>
          <Input
            id="sandbox-vercel-project-id"
            className="font-mono"
            placeholder="prj_…"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}

function VercelLoaded({ projectId }: { projectId: string }) {
  const { query, save } = useProjectVercel(projectId)
  const handleSave = (value: string) =>
    runAction({ work: () => save(value), success: 'Vercel project saved' })
  return (
    <QueryGate query={query} label="Vercel settings">
      {(saved) => <VercelForm key={saved} saved={saved} disabled={false} onSave={handleSave} />}
    </QueryGate>
  )
}

export function VercelSection({
  projectId,
  enabled = CLOUD_CAPABILITIES.projectSettings,
}: {
  projectId: string
  enabled?: boolean
}) {
  if (!enabled) return <VercelForm saved="" disabled onSave={async () => false} />
  return <VercelLoaded projectId={projectId} />
}
