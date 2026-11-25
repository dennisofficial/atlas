'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { VcpuSizeSelect } from '@dltech/atlas-ui/ai/vcpu-size-select'
import {
  AGENT37_SIZE_OPTIONS,
  DEFAULT_SANDBOX_VCPUS,
  podShapeOfSetting,
  type Agent37SizeOption,
} from '@dltech/atlas-wire/web'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { UnsavedHint } from '@/features/project-settings/settings-layout'

export const SANDBOX_SIZE_TITLE = 'Sandbox size'

const SECTION_DESCRIPTION =
  'The machine a new cloud sandbox boots on. Applies when a sandbox is created; resize a running one from its session.'

const INHERIT_VALUE = 'default'

export type SandboxSize = { vcpus: number; memoryGb: number | null }

export const DEFAULT_SANDBOX_SIZE: SandboxSize = { vcpus: DEFAULT_SANDBOX_VCPUS, memoryGb: null }

const shapeOf = (size: SandboxSize) =>
  podShapeOfSetting({ vcpus: size.vcpus, memoryGb: size.memoryGb ?? undefined })

export const sizeKeyOf = (size: SandboxSize): string => {
  const shape = shapeOf(size)
  return `${shape.vcpus}x${shape.memoryGb}`
}

const sizeOfKey = (key: string): SandboxSize => {
  const [rawVcpus, rawMemoryGb] = key.split('x')
  const vcpus = Number(rawVcpus)
  const memoryGb = Number(rawMemoryGb)
  if (
    rawVcpus === undefined ||
    rawMemoryGb === undefined ||
    !Number.isInteger(vcpus) ||
    !Number.isInteger(memoryGb)
  ) {
    throw new Error(`unknown sandbox size ${key}`)
  }
  return { vcpus, memoryGb }
}

const inheritOptionOf = (inherited: SandboxSize): Agent37SizeOption => {
  const shape = shapeOf(inherited)
  return {
    value: INHERIT_VALUE,
    label: 'Default',
    detail: `${shape.vcpus} vCPU · ${shape.memoryGb} GB RAM`,
  }
}

export const savedSizeValueOf = (args: {
  value: SandboxSize | null
  withAccountDefault: boolean
}): string => {
  if (args.value === null) {
    return args.withAccountDefault ? INHERIT_VALUE : sizeKeyOf(DEFAULT_SANDBOX_SIZE)
  }
  return sizeKeyOf(args.value)
}

export const sizeValueToSave = (args: {
  selected: string
  withAccountDefault: boolean
}): SandboxSize | null =>
  args.withAccountDefault && args.selected === INHERIT_VALUE ? null : sizeOfKey(args.selected)

export function SandboxSizeSection({
  value,
  inherited = DEFAULT_SANDBOX_SIZE,
  withAccountDefault,
  options = AGENT37_SIZE_OPTIONS,
  onSave,
}: {
  value: SandboxSize | null
  inherited?: SandboxSize
  withAccountDefault?: boolean
  options?: readonly Agent37SizeOption[]
  onSave: (size: SandboxSize | null) => Promise<unknown>
}) {
  const saved = savedSizeValueOf({ value, withAccountDefault: withAccountDefault === true })
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
            options={withAccountDefault ? [inheritOptionOf(inherited), ...options] : [...options]}
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
