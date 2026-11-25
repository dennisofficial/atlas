'use client'

import { decodeSettingValue, EConfigLayer } from '@dltech/atlas-wire/web'

import { useSettingLayers } from '@/features/settings/data/shared/use-layers'
import { sectionHrefOf, type SettingsScope } from '@/features/settings/scope/settings-scope'
import { EQueryState } from '@/lib/use-cloud-query'

import { InheritedLayers, InheritedRow, OverriddenBadge } from './inherited-layer-section'

const LABEL_OF_KEY: Readonly<Record<string, string>> = {
  'sandbox.vcpus': 'vCPUs',
  'sandbox.memoryGb': 'Memory (GB)',
  'sandbox.diskGb': 'Disk (GB)',
}

export const displayValueOf = (value: string): string => String(decodeSettingValue(value))

export function InheritedSettings({
  scope,
  section,
  keys,
}: {
  scope: SettingsScope
  section: string
  keys: readonly string[]
}) {
  const layers = useSettingLayers(scope)
  if (layers.state !== EQueryState.Ready) return null
  const own = scope.kind === 'project' ? EConfigLayer.Project : EConfigLayer.Group
  return (
    <InheritedLayers
      layers={layers.data
        .filter((entry) => entry.layer !== own)
        .map((entry) => ({
          ...entry,
          items: entry.values.filter((value) => keys.includes(value.key)),
        }))}
      keyOf={(value) => value.key}
      editHrefOf={({ layer, owner }) => {
        if (layer !== EConfigLayer.Group || owner.id === null) return null
        return sectionHrefOf({ scope: { kind: 'group', groupId: owner.id }, section })
      }}
      renderRow={({ item }) => (
        <InheritedRow key={item.key} shadow={item.overriddenBy}>
          <span className="min-w-0 flex-1 text-sm">{LABEL_OF_KEY[item.key] ?? item.key}</span>
          <span className="font-mono text-sm text-muted-foreground">
            {displayValueOf(item.value)}
          </span>
          {item.overriddenBy === null ? null : <OverriddenBadge shadow={item.overriddenBy} />}
        </InheritedRow>
      )}
    />
  )
}
