'use client'

import { useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Label } from '@dltech/atlas-ui/components/label'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { sandboxSizesOfPlan, vercelPlanCapNote } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { SandboxSizeSection } from '@/features/settings/parts/sandbox-size-section'
import { useVercelPlan } from '@/features/settings/data/user/use-vercel-plan'
import { SandboxPageSkeleton } from './project-skeletons'
import { runAction } from '@/features/settings/data/shared/run-action'

import { useProjectContext } from './data/project-context'
import { useSandbox } from './data/use-sandbox'
import {
  ERowLayout,
  FileChip,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from './settings-layout'

function DocsBadge() {
  return (
    <Badge variant="outline" render={<a href="https://github.com/dennisofficial/atlas" />}>
      Docs
      <ArrowUpRightIcon data-icon="inline-end" />
    </Badge>
  )
}

function SetupScript({
  saved,
  onSave,
}: {
  saved: string
  onSave: (script: string) => Promise<boolean>
}) {
  const [script, setScript] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = script !== saved
  const handleSave = async () => {
    setSaving(true)
    await onSave(script)
    setSaving(false)
  }
  return (
    <SettingsSection
      title="Setup script"
      description="Runs once after the repository is cloned, before the agent starts. Its result is snapshotted."
    >
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow
          title={
            <>
              <Label htmlFor="sandbox-setup-script">Setup</Label>
              <DocsBadge />
            </>
          }
          description={
            <>
              Runs once per sandbox in place of <FileChip>setup</FileChip> in{' '}
              <FileChip>.atlas/container.json</FileChip>.
            </>
          }
          layout={ERowLayout.Stacked}
        >
          <Textarea
            id="sandbox-setup-script"
            spellCheck={false}
            className="min-h-32 font-mono text-xs md:text-xs"
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}

export function SandboxPage() {
  const { projectId } = useProjectContext()
  const { query, save } = useSandbox(projectId)
  const plan = useVercelPlan()
  return (
    <QueryGate query={query} label="sandbox settings" skeleton={<SandboxPageSkeleton />}>
      {(sandbox) => {
        const handleSave = (patch: Partial<typeof sandbox>) =>
          runAction({
            work: () => save({ ...sandbox, ...patch }),
            success: 'Sandbox settings saved',
          })
        return (
          <>
            <SandboxSizeSection
              key={`size-${sandbox.vcpus}`}
              value={sandbox.vcpus}
              withAccountDefault
              sizes={sandboxSizesOfPlan(plan)}
              capNote={vercelPlanCapNote(plan)}
              onSave={(vcpus) => handleSave({ vcpus })}
            />
            <SetupScript
              key={`script-${sandbox.setupScript}`}
              saved={sandbox.setupScript}
              onSave={(setupScript) => handleSave({ setupScript })}
            />
          </>
        )
      }}
    </QueryGate>
  )
}
