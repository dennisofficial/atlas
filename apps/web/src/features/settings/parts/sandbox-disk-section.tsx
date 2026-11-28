'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { VcpuSizeSelect } from '@dltech/atlas-ui/ai/vcpu-size-select'
import { DEFAULT_SANDBOX_DISK_GB } from '@dltech/atlas-wire/web'
import {
  INHERIT_VALUE,
  defaultDiskGbOf,
  diskValueToSave,
  SANDBOX_DISK_DESCRIPTION,
  SANDBOX_DISK_OPTIONS,
  SANDBOX_DISK_TITLE,
  sandboxDiskOptionsOf,
  savedDiskValueOf,
} from '@dltech/atlas-client/settings'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { UnsavedHint } from '@/features/project-settings/settings-layout'

export {
  defaultDiskGbOf,
  INHERIT_VALUE,
  SANDBOX_DISK_OPTIONS,
  SANDBOX_DISK_TITLE,
  savedDiskValueOf,
  diskValueToSave,
}

export function SandboxDiskSection({
  value,
  inheritedDiskGb = DEFAULT_SANDBOX_DISK_GB,
  withAccountDefault,
  onSave,
}: {
  value: number | null
  inheritedDiskGb?: number
  withAccountDefault?: boolean
  onSave: (diskGb: number | null) => Promise<unknown>
}) {
  const saved = savedDiskValueOf({ diskGb: value, withAccountDefault: withAccountDefault === true })
  const [selected, setSelected] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = selected !== saved
  const options = sandboxDiskOptionsOf({
    inheritedDiskGb,
    withAccountDefault: withAccountDefault === true,
  })
  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(diskValueToSave({ selected, withAccountDefault: withAccountDefault === true }))
    } finally {
      setSaving(false)
    }
  }
  return (
    <SettingsSection title={SANDBOX_DISK_TITLE} description={SANDBOX_DISK_DESCRIPTION}>
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
            options={options}
            value={selected}
            onValueChange={setSelected}
            showSelectedDetail={withAccountDefault === true}
            aria-label="Sandbox disk"
            id="sandbox-disk"
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
