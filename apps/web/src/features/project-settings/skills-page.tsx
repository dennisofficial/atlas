'use client'

import { useMemo } from 'react'

import { EConfigLayer } from '@dltech/atlas-wire/web'

import { useSkillLayers } from '@/features/settings/data/shared/use-layers'
import {
  InheritedLayers,
  InheritedRow,
  OverriddenBadge,
} from '@/features/settings/parts/layers/inherited-layer-section'
import {
  sectionHrefOf,
  skillTargetOf,
  useSettingsScope,
  type SettingsScope,
} from '@/features/settings/scope/settings-scope'
import { SkillsListPage } from '@/features/settings/parts/skills-list-view'
import { EQueryState } from '@/lib/use-cloud-query'

const ownLayerOf = (scope: SettingsScope): EConfigLayer =>
  scope.kind === 'project' ? EConfigLayer.Project : EConfigLayer.Group

const descriptionOf = (scope: SettingsScope): string =>
  scope.kind === 'project'
    ? 'Skills stored for this project, loaded in threads on this project.'
    : 'Skills stored for this group, loaded in every project in it.'

function InheritedSkills({ scope }: { scope: SettingsScope }) {
  const target = useMemo(() => skillTargetOf(scope), [scope])
  const layers = useSkillLayers(target)
  if (layers.state !== EQueryState.Ready) return null
  const own = ownLayerOf(scope)
  return (
    <InheritedLayers
      layers={layers.data.filter((entry) => entry.layer !== own)}
      keyOf={(skill) => skill.name}
      editHrefOf={({ layer, owner }) => {
        if (layer === EConfigLayer.Personal) return '/settings/skills'
        if (layer !== EConfigLayer.Group || owner.id === null) return null
        return sectionHrefOf({ scope: { kind: 'group', groupId: owner.id }, section: 'skills' })
      }}
      renderRow={({ item }) => (
        <InheritedRow key={item.name} shadow={item.overriddenBy}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-sm font-medium">{item.name}</span>
            {item.description === '' ? null : (
              <span className="truncate text-xs text-muted-foreground">{item.description}</span>
            )}
          </div>
          {item.overriddenBy === null ? null : <OverriddenBadge shadow={item.overriddenBy} />}
        </InheritedRow>
      )}
    />
  )
}

export function ProjectSkillsPage() {
  const scope = useSettingsScope()
  const target = useMemo(() => skillTargetOf(scope), [scope])
  return (
    <>
      <SkillsListPage
        target={target}
        title="Skills"
        description={descriptionOf(scope)}
        detailHref={(name) =>
          `${sectionHrefOf({ scope, section: 'skills' })}/${encodeURIComponent(name)}`
        }
      />
      <InheritedSkills scope={scope} />
    </>
  )
}
