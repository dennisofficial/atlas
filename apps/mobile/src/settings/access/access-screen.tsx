import {
  accessGrantMatchesQuery,
  accessGrantSummary,
  EAccessScope,
  accessParamsOfScope,
  type AccessScope,
  inheritedTitleOf,
} from '@dltech/atlas-client/settings'
import { EConfigLayer } from '@dltech/atlas-wire/web'
import { Stack, router } from 'expo-router'
import { useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { NavRow, Section, StatusRows } from '../settings-parts'
import { SettingsScroll } from '../settings-scroll'
import { useApiResource } from '../use-api-resource'
import { AccessHeaderAction, AccessNote, openAccessForm, useAccess } from './access-parts'

const InheritedAccess = ({ scope }: { scope: AccessScope }) => {
  const { api } = useAuth()
  const own = scope.kind === EAccessScope.Project ? EConfigLayer.Project : EConfigLayer.Group
  const { data, state, reload } = useApiResource({
    load: async () => {
      if (api === undefined) throw new Error('Not signed in')
      return (await api.accessGrants.layered.query({ scope })).layers.filter(
        (layer) => layer.layer !== own,
      )
    },
    deps: [api, JSON.stringify(scope)],
  })
  return (
    <>
      <StatusRows state={state} onRetry={reload} failure="Inherited access could not be loaded." />
      {data
        ?.filter((layer) => layer.grants.length > 0)
        .map((layer) => (
          <Section key={layer.layer} title={inheritedTitleOf(layer)}>
            {layer.grants.map((grant) => (
              <AccessNote key={grant.id}>
                {[
                  grant.name,
                  grant.instruction,
                  ...grant.secrets.map(
                    (secret) =>
                      `${secret.name}${secret.overriddenBy === null ? '' : ` (overridden by ${secret.overriddenBy})`}`,
                  ),
                  ...grant.files.map(
                    (file) =>
                      `${file.path}${file.overriddenBy === null ? '' : ` (overridden by ${file.overriddenBy})`}`,
                  ),
                ]
                  .filter(Boolean)
                  .join('\n')}
              </AccessNote>
            ))}
            <NavRow
              label="Edit inherited access"
              onPress={() => {
                if (layer.layer === EConfigLayer.Personal) router.push('/settings/access')
                else if (layer.owner.id !== null)
                  router.push(`/group-settings/${encodeURIComponent(layer.owner.id)}/access`)
              }}
            />
          </Section>
        ))}
    </>
  )
}

export const AccessScreen = ({ scope }: { scope: AccessScope }) => {
  const { state, data, reload } = useAccess(scope)
  const [query, setQuery] = useState('')
  const grants = data?.filter((grant) => accessGrantMatchesQuery({ grant, query })) ?? []
  const handleAdd = () => openAccessForm({ scope, mode: 'grant' })
  return (
    <SettingsScroll>
      <AccessHeaderAction label="New grant" symbol="plus" onPress={handleAdd} />
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placement: 'integratedButton',
            placeholder: 'Search access',
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <AccessNote text="Tell the agent what each secret and file gives it access to. Atlas sends this to every session." />
      <StatusRows state={state} onRetry={reload} failure="Access grants could not be loaded." />
      {data === null ? null : (
        <Section title="Access grants">
          {grants.length === 0 ? (
            <AccessNote>
              {query
                ? 'No grants match. Clear the search to see all grants.'
                : 'No grants yet. Use New grant to add secrets and describe what they give the agent access to.'}
            </AccessNote>
          ) : (
            grants.map((grant) => (
              <NavRow
                key={grant.id}
                label={grant.name}
                value={accessGrantSummary(grant)}
                onPress={() =>
                  router.push({
                    pathname: '/settings/access-grant',
                    params: { ...accessParamsOfScope(scope), grantId: grant.id },
                  })
                }
              />
            ))
          )}
        </Section>
      )}
      {scope.kind === EAccessScope.Personal ? null : <InheritedAccess scope={scope} />}
    </SettingsScroll>
  )
}
