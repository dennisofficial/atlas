'use client'

import { EConfigLayer, encodeSettingValue } from '@dltech/atlas-wire/web'

import {
  ownValuesOf,
  SANDBOX_SETTING_KEYS,
  sandboxOfValues,
  sizeSettingValuesOf,
  inheritedSandboxOf,
} from '@/features/project-settings/data/inherited-sandbox'
import { LoadingRegion } from '@/features/settings/data/shared/query-gate'
import { runAction } from '@/features/settings/data/shared/run-action'
import { useSettingLayers } from '@/features/settings/data/shared/use-layers'
import { InheritedSettings } from '@/features/settings/parts/layers/inherited-settings-section'
import { defaultDiskGbOf, SandboxDiskSection } from '@/features/settings/parts/sandbox-disk-section'
import {
  DEFAULT_SANDBOX_SIZE,
  SandboxSizeSection,
} from '@/features/settings/parts/sandbox-size-section'
import { useSettingsScope } from '@/features/settings/scope/settings-scope'
import { EQueryState } from '@/lib/use-cloud-query'

import { useGroupContext } from './data/group-context'
import { patchGroupSettings } from './data/group-settings-api'

const LOADING_KEYS = ['a', 'b']

function SandboxSkeleton() {
  return (
    <LoadingRegion label="group sandbox settings" className="flex flex-col gap-6">
      {LOADING_KEYS.map((key) => (
        <div key={key} className="h-20 w-full rounded-xl bg-muted" />
      ))}
    </LoadingRegion>
  )
}

export function GroupSandboxPage() {
  const { group } = useGroupContext()
  const scope = useSettingsScope()
  const layers = useSettingLayers(scope)
  if (layers.state !== EQueryState.Ready) return <SandboxSkeleton />

  const below = inheritedSandboxOf({ layers: layers.data, own: EConfigLayer.Group })
  const saved = sandboxOfValues(ownValuesOf({ layers: layers.data, own: EConfigLayer.Group }))
  const handleSave = async (values: Record<string, string | null>): Promise<void> => {
    await runAction({
      work: () => patchGroupSettings({ groupId: group.id, values }),
      success: 'Sandbox settings saved',
    })
    layers.reload()
  }
  return (
    <>
      <SandboxSizeSection
        key={`size-${String(saved.size?.vcpus ?? 'default')}-${String(saved.size?.memoryGb ?? 'default')}`}
        value={saved.size}
        inherited={below.size ?? DEFAULT_SANDBOX_SIZE}
        withAccountDefault
        onSave={(size) => handleSave(sizeSettingValuesOf(size))}
      />
      <SandboxDiskSection
        key={`disk-${String(saved.diskGb ?? 'default')}`}
        value={saved.diskGb}
        inheritedDiskGb={below.diskGb ?? defaultDiskGbOf(undefined)}
        withAccountDefault
        onSave={(diskGb) =>
          handleSave({ 'sandbox.diskGb': diskGb === null ? null : encodeSettingValue(diskGb) })
        }
      />
      <InheritedSettings scope={scope} section="sandbox" keys={SANDBOX_SETTING_KEYS} />
    </>
  )
}
