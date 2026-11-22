'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { VcpuSizeSelect } from '@dltech/atlas-ui/ai/vcpu-size-select'
import {
  AGENT37_SIZE_OPTIONS,
  agent37ShapeOfVcpus,
  DEFAULT_SANDBOX_VCPUS,
  type Agent37SizeOption,
} from '@dltech/atlas-wire/web'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { UnsavedHint } from '@/features/project-settings/settings-layout'

export const SANDBOX_SIZE_TITLE = 'Sandbox size'

const SECTION_DESCRIPTION =
  'The machine a new cloud sandbox boots on. Applies when a sandbox is created; resize a running one from its session.'

const INHERIT_VALUE = 'default'

export const defaultVcpusOf = (personalVcpus: number | undefined): number =>
  personalVcpus ?? DEFAULT_SANDBOX_VCPUS

const inheritOptionOf = (vcpus: number): Agent37SizeOption => {
  const shape = agent37ShapeOfVcpus(vcpus)
  return {
    value: INHERIT_VALUE,
    label: 'Default',
    detail: `${shape.vcpus} vCPU · ${shape.memoryGb} GB RAM`,
  }
}

const sizeValueOf = (vcpus: number): string => String(agent37ShapeOfVcpus(vcpus).vcpus)

export const savedSizeValueOf = (args: {
  vcpus: number | null
  withAccountDefault: boolean
}): string => {
  if (args.vcpus === null) {
    return args.withAccountDefault ? INHERIT_VALUE : sizeValueOf(DEFAULT_SANDBOX_VCPUS)
  }
  return sizeValueOf(args.vcpus)
}

export const sizeValueToSave = (args: {
  selected: string
  withAccountDefault: boolean
}): number | null =>
  args.withAccountDefault && args.selected === INHERIT_VALUE ? null : Number(args.selected)

export function SandboxSizeSection({
  value,
  inheritedVcpus = DEFAULT_SANDBOX_VCPUS,
  withAccountDefault,
  options = AGENT37_SIZE_OPTIONS,
  onSave,
}: {
  value: number | null
  inheritedVcpus?: number
  withAccountDefault?: boolean
  options?: readonly Agent37SizeOption[]
  onSave: (vcpus: number | null) => Promise<unknown>
}) {
  const saved = savedSizeValueOf({ vcpus: value, withAccountDefault: withAccountDefault === true })
  const [selected, setSelected] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = selected !== saved
  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(sizeValueToSave({ selected, withAccountDefault: withAccountDefault === true }))
    } finally {
      setSaving(false)
    }
  }
  return (
    <SettingsSection title={SANDBOX_SIZE_TITLE} description={SECTION_DESCRIPTION}>
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
        <div className="px-4 py-3 sm:w-96">
          <VcpuSizeSelect
            sizes={[]}
            options={withAccountDefault ? [inheritOptionOf(inheritedVcpus), ...options] : options}
            value={selected}
            onValueChange={setSelected}
            showSelectedDetail={withAccountDefault === true}
            aria-label="Sandbox size"
            id="sandbox-size"
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
