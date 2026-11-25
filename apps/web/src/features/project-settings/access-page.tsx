'use client'

import { useMemo } from 'react'

import { EConfigLayer, type AccessGrantLayeredGrant } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { useGrantLayers } from '@/features/settings/data/shared/use-layers'
import {
  AccessGrantsContent,
  AccessGrantsSkeleton,
} from '@/features/settings/parts/access/access-grants-content'
import { accessMemberApiOf } from '@/features/settings/parts/access/access-members-api'
import { useAccessGrants } from '@/features/settings/parts/access/use-access-grants'
import {
  InheritedLayers,
  InheritedRow,
  OverriddenBadge,
} from '@/features/settings/parts/layers/inherited-layer-section'
import {
  accessScopeOf,
  sectionHrefOf,
  useSettingsScope,
  type SettingsScope,
} from '@/features/settings/scope/settings-scope'
import { EQueryState } from '@/lib/use-cloud-query'

import type { TreeEntry } from './data/file-mount-helpers'
import { useRepoTreeEntries } from './data/use-repo-tree'
import { SettingsSection } from './settings-layout'

const TITLE = 'Access'
const DESCRIPTION =
  'Tell the agent what each secret and file gives it access to. Atlas sends this to every session.'
const SECRET_DESCRIPTION = 'Available to every thread in this scope as an environment variable.'

const ownLayerOf = (scope: SettingsScope): EConfigLayer =>
  scope.kind === 'project' ? EConfigLayer.Project : EConfigLayer.Group

const shadowsOf = (grant: AccessGrantLayeredGrant): EConfigLayer[] =>
  [...grant.secrets, ...grant.files]
    .map((member) => member.overriddenBy)
    .filter((shadow): shadow is EConfigLayer => shadow !== null)

function MemberText({ label, shadow }: { label: string; shadow: EConfigLayer | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={shadow === null ? 'font-mono' : 'font-mono line-through'}>{label}</span>
      {shadow === null ? null : <OverriddenBadge shadow={shadow} />}
    </span>
  )
}

function InheritedGrants({ scope }: { scope: SettingsScope }) {
  const layers = useGrantLayers(accessScopeOf(scope))
  if (layers.state !== EQueryState.Ready) return null
  const own = ownLayerOf(scope)
  return (
    <InheritedLayers
      layers={layers.data
        .filter((entry) => entry.layer !== own)
        .map((entry) => ({ layer: entry.layer, owner: entry.owner, items: entry.grants }))}
      keyOf={(grant) => grant.id}
      editHrefOf={({ layer, owner }) => {
        if (layer === EConfigLayer.Personal) return '/settings/access'
        if (layer !== EConfigLayer.Group || owner.id === null) return null
        return sectionHrefOf({ scope: { kind: 'group', groupId: owner.id }, section: 'access' })
      }}
      renderRow={({ item }) => {
        const shadows = shadowsOf(item)
        return (
          <InheritedRow key={item.id} shadow={shadows[0] ?? null}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-mono text-sm font-medium">{item.name}</span>
              {item.instruction === '' ? null : (
                <span className="truncate text-xs text-muted-foreground">{item.instruction}</span>
              )}
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {item.secrets.map((secret) => (
                  <MemberText
                    key={`secret:${secret.name}`}
                    label={secret.name}
                    shadow={secret.overriddenBy}
                  />
                ))}
                {item.files.map((file) => (
                  <MemberText
                    key={`file:${file.path}`}
                    label={file.path}
                    shadow={file.overriddenBy}
                  />
                ))}
              </span>
            </div>
          </InheritedRow>
        )
      }}
    />
  )
}

function AccessScopePage({
  scope,
  entries,
}: {
  scope: SettingsScope
  entries: readonly TreeEntry[]
}) {
  const accessScope = useMemo(() => accessScopeOf(scope), [scope])
  const members = useMemo(() => accessMemberApiOf(accessScope), [accessScope])
  const { query, actions } = useAccessGrants({ scope: accessScope, members })
  return (
    <>
      <InheritedGrants scope={scope} />
      <SettingsSection title={TITLE} description={DESCRIPTION}>
        <QueryGate query={query} label="access grants" skeleton={<AccessGrantsSkeleton />}>
          {(snapshot) => (
            <AccessGrantsContent
              grants={snapshot.grants}
              now={snapshot.fetchedAt}
              personal={false}
              entries={entries}
              secretDescription={SECRET_DESCRIPTION}
              actions={actions}
            />
          )}
        </QueryGate>
      </SettingsSection>
    </>
  )
}

function ProjectAccessPage({ projectId }: { projectId: string }) {
  const scope = useMemo(() => ({ kind: 'project', projectId }) as const, [projectId])
  const tree = useRepoTreeEntries(projectId)
  const entries = tree.state === EQueryState.Ready ? tree.data : []
  return <AccessScopePage scope={scope} entries={entries} />
}

export function AccessPage() {
  const scope = useSettingsScope()
  if (scope.kind === 'group') return <AccessScopePage scope={scope} entries={[]} />
  return <ProjectAccessPage projectId={scope.projectId} />
}
