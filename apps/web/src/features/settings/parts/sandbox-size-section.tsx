'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { VcpuSizeSelect } from '@dltech/atlas-ui/ai/vcpu-size-select'
import { AGENT37_SIZE_OPTIONS, type Agent37SizeOption } from '@dltech/atlas-wire/web'
import {
  DEFAULT_SANDBOX_SIZE,
  INHERIT_VALUE,
  savedSizeValueOf,
  sandboxSizeOptionsOf,
  SANDBOX_SIZE_DESCRIPTION,
  SANDBOX_SIZE_TITLE,
  sizeKeyOf,
  sizeValueToSave,
  type ISandboxSize as SandboxSize,
} from '@dltech/atlas-client/settings'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { UnsavedHint } from '@/features/project-settings/settings-layout'

export {
  DEFAULT_SANDBOX_SIZE,
  INHERIT_VALUE,
  savedSizeValueOf,
  SANDBOX_SIZE_TITLE,
  sizeKeyOf,
  sizeValueToSave,
}
export type { SandboxSize }

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
  const choices = sandboxSizeOptionsOf({
    inherited,
    withAccountDefault: withAccountDefault === true,
    options,
  })
  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(sizeValueToSave({ selected, withAccountDefault: withAccountDefault === true }))
    } finally {
      setSaving(false)
    }
  }
  return (
    <SettingsSection title={SANDBOX_SIZE_TITLE} description={SANDBOX_SIZE_DESCRIPTION}>
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
            options={choices}
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
