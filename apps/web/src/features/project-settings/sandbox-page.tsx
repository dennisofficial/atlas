'use client'

import { useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Label } from '@dltech/atlas-ui/components/label'
import { RadioGroup, RadioGroupItem } from '@dltech/atlas-ui/components/radio-group'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { QueryGate } from '@/features/settings/data/workspace/query-gate'
import { runAction } from '@/features/settings/data/workspace/run-action'

import { useProjectContext } from './data/project-context'
import {
  MEMORY_GB_PER_VCPU,
  SANDBOX_SIZE_OPTIONS,
  sizeIdOf,
  vcpusOfSizeId,
  type SandboxSize,
} from './data/sandbox-mapping'
import { useSandbox } from './data/use-sandbox'
import {
  ERowLayout,
  FileChip,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from './settings-layout'

function SizeCard({ size }: { size: SandboxSize }) {
  const id = `sandbox-size-${size.id}`
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer flex-col items-stretch gap-3 rounded-lg border bg-card p-3 font-normal transition-colors',
        'hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5',
        'has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {size.vcpus === null ? 'Account default' : `${size.vcpus} vCPU`}
        </span>
        <RadioGroupItem id={id} value={size.id} />
      </span>
      <span className="font-mono text-xs leading-relaxed text-muted-foreground">
        {size.memoryGb === null
          ? 'Uses your Sandbox size setting'
          : `${size.memoryGb} GB RAM (${MEMORY_GB_PER_VCPU} GB per vCPU)`}
      </span>
    </Label>
  )
}

function SizePicker({
  vcpus,
  onSave,
}: {
  vcpus: number | null
  onSave: (vcpus: number | null) => Promise<boolean>
}) {
  const saved = sizeIdOf(vcpus)
  const [selected, setSelected] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = selected !== saved
  const handleValueChange = (value: unknown) => {
    if (typeof value === 'string') setSelected(value)
  }
  const handleSave = async () => {
    setSaving(true)
    await onSave(vcpusOfSizeId(selected))
    setSaving(false)
  }
  return (
    <SettingsSection
      title="Sandbox size"
      description="vCPUs for every new sandbox in this project. Applies at creation only; an existing sandbox keeps its size."
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
        <div className="p-4">
          <RadioGroup
            aria-label="Sandbox size"
            value={selected}
            onValueChange={handleValueChange}
            className="grid-cols-2 gap-3 lg:grid-cols-5"
          >
            {SANDBOX_SIZE_OPTIONS.map((size) => (
              <SizeCard key={size.id} size={size} />
            ))}
          </RadioGroup>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

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
              Overrides <FileChip>setup</FileChip> in <FileChip>.atlas/container.json</FileChip>{' '}
              when both are set.
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
  return (
    <QueryGate query={query} label="sandbox settings">
      {(sandbox) => {
        const handleSave = (patch: Partial<typeof sandbox>) =>
          runAction({
            work: () => save({ ...sandbox, ...patch }),
            success: 'Sandbox settings saved',
          })
        return (
          <>
            <SizePicker
              key={`size-${sandbox.vcpus}`}
              vcpus={sandbox.vcpus}
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
