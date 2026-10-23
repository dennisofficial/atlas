import { useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Label } from '@dltech/atlas-ui/components/label'
import { RadioGroup, RadioGroupItem } from '@dltech/atlas-ui/components/radio-group'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  DEFAULT_SANDBOX_VCPUS,
  SANDBOX_SIZES,
  SETUP_SCRIPT,
  type SandboxSize,
} from '../../fixtures/project-settings'
import {
  ERowLayout,
  FileChip,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from '../settings/settings-layout'

function SizeCard({ size }: { size: SandboxSize }) {
  const id = `sandbox-size-${size.vcpus}`
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
        <span className="text-sm font-medium">{size.vcpus} vCPU</span>
        <RadioGroupItem id={id} value={String(size.vcpus)} />
      </span>
      <span className="font-mono text-xs text-muted-foreground">{size.memoryGb} GB RAM</span>
    </Label>
  )
}

function SizePicker() {
  const [saved, setSaved] = useState(String(DEFAULT_SANDBOX_VCPUS))
  const [selected, setSelected] = useState(String(DEFAULT_SANDBOX_VCPUS))
  const dirty = selected !== saved
  const handleValueChange = (value: unknown) => {
    if (typeof value === 'string') setSelected(value)
  }
  return (
    <SettingsSection title="Sandbox size" description="Applies to new threads in this project.">
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={!dirty} onClick={() => setSaved(selected)}>
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
            className="grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {SANDBOX_SIZES.map((size) => (
              <SizeCard key={size.vcpus} size={size} />
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

function SetupScript() {
  const [saved, setSaved] = useState(SETUP_SCRIPT)
  const [script, setScript] = useState(SETUP_SCRIPT)
  const dirty = script !== saved
  return (
    <SettingsSection
      title="Setup script"
      description="Runs once after the repository is cloned, before the agent starts."
    >
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={!dirty} onClick={() => setSaved(script)}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow
          title={
            <>
              <Label htmlFor="sandbox-setup-script">Script</Label>
              <DocsBadge />
            </>
          }
          description={
            <>
              Takes precedence over <FileChip>setup</FileChip> in{' '}
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
  return (
    <SettingsPage title="Sandbox" description="How this project's sandboxes are sized and set up.">
      <SizePicker />
      <SetupScript />
    </SettingsPage>
  )
}
