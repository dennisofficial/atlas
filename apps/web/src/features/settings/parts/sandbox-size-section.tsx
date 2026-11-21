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

const ACCOUNT_DEFAULT_OPTION: Agent37SizeOption = {
  value: 'default',
  label: 'Account default',
  detail: 'Your personal default',
}

const sizeValueOf = (vcpus: number): string => String(agent37ShapeOfVcpus(vcpus).vcpus)

export const savedSizeValueOf = (args: {
  vcpus: number | null
  withAccountDefault: boolean
}): string => {
  if (args.vcpus === null) {
    return args.withAccountDefault
      ? ACCOUNT_DEFAULT_OPTION.value
      : sizeValueOf(DEFAULT_SANDBOX_VCPUS)
  }
  return sizeValueOf(args.vcpus)
}

export function SandboxSizeSection({
  value,
  withAccountDefault,
  options = AGENT37_SIZE_OPTIONS,
  onSave,
}: {
  value: number | null
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
      await onSave(
        withAccountDefault && selected === ACCOUNT_DEFAULT_OPTION.value ? null : Number(selected),
      )
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
            options={withAccountDefault ? [ACCOUNT_DEFAULT_OPTION, ...options] : options}
            value={selected}
            onValueChange={setSelected}
            aria-label="Sandbox size"
            id="sandbox-size"
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
