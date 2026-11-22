'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { VcpuSizeSelect, type VcpuSizeOption } from '@dltech/atlas-ui/ai/vcpu-size-select'
import { DEFAULT_SANDBOX_DISK_GB, SANDBOX_DISK_GB_SIZES } from '@dltech/atlas-wire/web'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { UnsavedHint } from '@/features/project-settings/settings-layout'

export const SANDBOX_DISK_TITLE = 'Sandbox disk'

const SECTION_DESCRIPTION =
  'Disk size for new pods. Pods grow automatically when they fill up. Agent37 pods only.'

const ACCOUNT_DEFAULT_OPTION: VcpuSizeOption = {
  value: 'default',
  label: 'Account default',
  detail: 'Your personal default',
}

export const SANDBOX_DISK_OPTIONS: readonly VcpuSizeOption[] = SANDBOX_DISK_GB_SIZES.map(
  (diskGb) => ({ value: String(diskGb), label: `${diskGb} GB` }),
)

export const savedDiskValueOf = (args: {
  diskGb: number | null
  withAccountDefault: boolean
}): string => {
  if (args.diskGb === null) {
    return args.withAccountDefault ? ACCOUNT_DEFAULT_OPTION.value : String(DEFAULT_SANDBOX_DISK_GB)
  }
  return String(args.diskGb)
}

export function SandboxDiskSection({
  value,
  withAccountDefault,
  onSave,
}: {
  value: number | null
  withAccountDefault?: boolean
  onSave: (diskGb: number | null) => Promise<unknown>
}) {
  const saved = savedDiskValueOf({ diskGb: value, withAccountDefault: withAccountDefault === true })
  const [selected, setSelected] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = selected !== saved
  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(
        withAccountDefault && selected === ACCOUNT_DEFAULT_OPTION.value ? null : Number(selected),
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <SettingsSection title={SANDBOX_DISK_TITLE} description={SECTION_DESCRIPTION}>
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
            options={
              withAccountDefault
                ? [ACCOUNT_DEFAULT_OPTION, ...SANDBOX_DISK_OPTIONS]
                : SANDBOX_DISK_OPTIONS
            }
            value={selected}
            onValueChange={setSelected}
            aria-label="Sandbox disk"
            id="sandbox-disk"
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
