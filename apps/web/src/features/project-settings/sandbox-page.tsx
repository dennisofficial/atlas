'use client'

import { useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Label } from '@dltech/atlas-ui/components/label'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { useSettingLayers } from '@/features/settings/data/shared/use-layers'
import { InheritedSettings } from '@/features/settings/parts/layers/inherited-settings-section'
import { defaultDiskGbOf, SandboxDiskSection } from '@/features/settings/parts/sandbox-disk-section'
import {
  DEFAULT_SANDBOX_SIZE,
  SandboxSizeSection,
} from '@/features/settings/parts/sandbox-size-section'
import { useSettingsScope } from '@/features/settings/scope/settings-scope'
import { EConfigLayer } from '@dltech/atlas-wire/web'
import { EQueryState } from '@/lib/use-cloud-query'
import { SandboxPageSkeleton } from './project-skeletons'
import { runAction } from '@/features/settings/data/shared/run-action'

import { inheritedSandboxOf, SANDBOX_SETTING_KEYS } from './data/inherited-sandbox'
import { useProjectContext } from './data/project-context'
import { useSandbox } from './data/use-sandbox'
import {
  ERowLayout,
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
      description="Runs once per sandbox after the repository is cloned, before the agent starts."
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
  const scope = useSettingsScope()
  const { query, save } = useSandbox(projectId)
  const layers = useSettingLayers(scope)
  const below =
    layers.state === EQueryState.Ready
      ? inheritedSandboxOf({ layers: layers.data, own: EConfigLayer.Project })
      : { size: DEFAULT_SANDBOX_SIZE, diskGb: defaultDiskGbOf(undefined) }
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
              key={`size-${String(sandbox.vcpus)}-${String(sandbox.memoryGb)}`}
              value={
                sandbox.vcpus === null ? null : { vcpus: sandbox.vcpus, memoryGb: sandbox.memoryGb }
              }
              inherited={below.size}
              withAccountDefault
              onSave={(size) =>
                handleSave({ vcpus: size?.vcpus ?? null, memoryGb: size?.memoryGb ?? null })
              }
            />
            <SandboxDiskSection
              key={`disk-${sandbox.diskGb}`}
              value={sandbox.diskGb}
              inheritedDiskGb={below.diskGb}
              withAccountDefault
              onSave={(diskGb) => handleSave({ diskGb })}
            />
            <SetupScript
              key={`script-${sandbox.setupScript}`}
              saved={sandbox.setupScript}
              onSave={(setupScript) => handleSave({ setupScript })}
            />
            <InheritedSettings scope={scope} section="sandbox" keys={SANDBOX_SETTING_KEYS} />
          </>
        )
      }}
    </QueryGate>
  )
}
