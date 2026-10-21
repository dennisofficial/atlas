'use client'

import { useState } from 'react'
import { ArrowUpRightIcon, CircleCheckIcon, CircleDashedIcon, SparklesIcon } from 'lucide-react'

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
  REPO_FILES,
  SNAPSHOTS,
  type RepoFileStatus,
  type SandboxSnapshot,
} from './fixtures/project-settings'
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

function SizePicker({ vcpus, onSave }: { vcpus: number | null; onSave: (vcpus: number | null) => Promise<boolean> }) {
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

function RepoFileRow({ file }: { file: RepoFileStatus }) {
  const StatusIcon = file.present ? CircleCheckIcon : CircleDashedIcon
  return (
    <SettingsRow title={<FileChip>{file.path}</FileChip>} description={file.description}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-sm',
          file.present ? 'text-success' : 'text-muted-foreground',
        )}
      >
        <StatusIcon className="size-4" />
        {file.present ? 'Present on main' : 'Not present on main'}
      </span>
    </SettingsRow>
  )
}

function RepoFiles({ files }: { files: readonly RepoFileStatus[] }) {
  return (
    <SettingsSection
      title="Repository files"
      description="Sample data — Atlas doesn't check the repository yet. Atlas reads these from the base branch when it builds the sandbox image."
    >
      <SettingsCard
        footer={
          <Button variant="outline" size="sm">
            <SparklesIcon data-icon="inline-start" />
            Set up with Atlas
          </Button>
        }
      >
        {files.map((file) => (
          <RepoFileRow key={file.path} file={file} />
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

function SnapshotRow({ snapshot, onDelete }: { snapshot: SandboxSnapshot; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="font-mono text-sm">{snapshot.size}</span>
      {snapshot.isProjectDefault ? <Badge variant="secondary">Project default</Badge> : null}
      <span className="ml-auto text-sm text-muted-foreground">{snapshot.cachedFor}</span>
      <Button variant="outline" size="sm" onClick={onDelete}>
        Delete
      </Button>
    </div>
  )
}

function Snapshots() {
  const [snapshots, setSnapshots] = useState(SNAPSHOTS)
  const handleDelete = (id: string) =>
    setSnapshots((current) => current.filter((item) => item.id !== id))
  return (
    <SettingsSection
      title="Snapshots"
      description="Sample data — snapshots aren't tracked yet. A snapshot is the sandbox right after setup, so new threads skip the clone and install."
    >
      <SettingsCard>
        {snapshots.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No snapshots yet. The next thread in this project creates one.
          </p>
        ) : (
          snapshots.map((snapshot) => (
            <SnapshotRow
              key={snapshot.id}
              snapshot={snapshot}
              onDelete={() => handleDelete(snapshot.id)}
            />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  )
}

export function SandboxPage({ repoFiles = REPO_FILES }: { repoFiles?: readonly RepoFileStatus[] }) {
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
            <RepoFiles files={repoFiles} />
            <Snapshots />
          </>
        )
      }}
    </QueryGate>
  )
}
