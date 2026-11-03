'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { VcpuSizeSelect } from '@dltech/atlas-ui/ai/vcpu-size-select'
import { SANDBOX_VCPU_PLAN_CAP_NOTE, SANDBOX_VCPU_SIZES } from '@dltech/atlas-wire/web'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { UnsavedHint } from '@/features/project-settings/settings-layout'

export const SANDBOX_SIZE_TITLE = 'Sandbox size'

const SECTION_DESCRIPTION =
  'vCPUs a new cloud sandbox boots with, 2 GB RAM each. Applies when a sandbox is created; resize a running one from its thread.'

export function SandboxSizeSection({
  value,
  withAccountDefault,
  onSave,
}: {
  value: number | null
  withAccountDefault?: boolean
  onSave: (vcpus: number | null) => Promise<unknown>
}) {
  const saved = value === null && withAccountDefault ? 'default' : String(value)
  const [selected, setSelected] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = selected !== saved
  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(withAccountDefault && selected === 'default' ? null : Number(selected))
    } finally {
      setSaving(false)
    }
  }
  return (
    <SettingsSection
      title={SANDBOX_SIZE_TITLE}
      description={`${SECTION_DESCRIPTION} ${SANDBOX_VCPU_PLAN_CAP_NOTE}.`}
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
        <div className="px-4 py-3 sm:w-96">
          <VcpuSizeSelect
            sizes={SANDBOX_VCPU_SIZES}
            value={selected}
            onValueChange={setSelected}
            options={
              withAccountDefault
                ? [
                    {
                      value: 'default',
                      label: 'Account default',
                      detail: 'Your personal default',
                    },
                  ]
                : undefined
            }
            aria-label="Sandbox size"
            id="sandbox-size"
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
