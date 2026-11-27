import {
  diskSettingValuesOf,
  inheritedSandboxOf,
  ownValuesOf,
  sandboxOfValues,
  sizeSettingValuesOf,
} from '@dltech/atlas-client/settings'
import { EConfigLayer, type LayeredSettingLayer } from '@dltech/atlas-wire/web'
import { useLocalSearchParams } from 'expo-router'

import { useAuth } from '../../../../auth/auth-provider'
import { EResourceState } from '../../../../settings/api-resource-state'
import { DiskChoice, InheritedSandboxRows, SizeChoice } from '../../../../settings/sandbox-parts'
import { StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { useApiResource } from '../../../../settings/use-api-resource'

export default function GroupSandboxScreen() {
  const { api } = useAuth()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const { state, data, reload } = useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve<readonly LayeredSettingLayer[]>([])
        : api.groupResources.layeredSettings.query({ groupId }).then((body) => body.layers),
    deps: [api, groupId],
  })

  const handleSave = async (values: Record<string, string | null>) => {
    if (api === undefined) return
    await api.groupResources.patchSettings.mutate({ groupId, values })
    reload()
  }

  const layers = data ?? []
  const saved = sandboxOfValues(ownValuesOf({ layers, own: EConfigLayer.Group }))
  const below = inheritedSandboxOf({ layers, own: EConfigLayer.Group })

  return (
    <SettingsScroll>
      <StatusRows
        state={state}
        onRetry={reload}
        failure="The group sandbox settings could not be loaded."
      />
      {state !== EResourceState.Ready ? null : (
        <>
          <SizeChoice
            key={`size-${String(saved.size?.vcpus ?? 'default')}-${String(saved.size?.memoryGb ?? 'default')}`}
            saved={saved.size}
            inherited={below.size}
            onSave={(size) => handleSave(sizeSettingValuesOf(size))}
          />
          <DiskChoice
            key={`disk-${String(saved.diskGb ?? 'default')}`}
            saved={saved.diskGb}
            inheritedDiskGb={below.diskGb}
            onSave={(diskGb) => handleSave(diskSettingValuesOf(diskGb))}
          />
          <InheritedSandboxRows layers={layers} own={EConfigLayer.Group} />
        </>
      )}
    </SettingsScroll>
  )
}
