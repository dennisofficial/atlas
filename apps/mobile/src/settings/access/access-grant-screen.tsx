import {
  formatFileMode,
  accessParamsOfScope,
  formatMemoryDate,
  accessScopeOfParams,
  deleteGrantDescription,
  grantMoveBranchesOf,
  scopeKeyOf,
  type AccessRouteParams,
} from '@dltech/atlas-client/settings'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import { ChoiceRow } from '../choice-row'
import { confirmAction } from '../confirm-action'
import { ActionRow, EActionTone, NavRow, Section, StatusRows } from '../settings-parts'
import { SettingsScroll } from '../settings-scroll'
import { useApiResource } from '../use-api-resource'
import { AccessHeaderAction, AccessNote, openAccessForm, useAccess } from './access-parts'

export default function AccessGrantScreen() {
  const params = useLocalSearchParams<AccessRouteParams>()
  const scope = accessScopeOfParams(params)
  const { api, state, data, reload } = useAccess(scope)
  const grant = data?.find((entry) => entry.id === params.grantId)
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const targets = useApiResource({
    load: async () => {
      if (api === undefined) throw new Error('Not signed in')
      const [groups, projects] = await Promise.all([
        api.projectGroups.list.query(),
        api.projects.list.query(),
      ])
      return grantMoveBranchesOf({ scope, groups: groups.groups, projects }).flatMap((branch) =>
        branch.targets.map((target) => ({ ...target, label: `${branch.label} · ${target.name}` })),
      )
    },
    deps: [api, scopeKeyOf(scope)],
  })
  const handleWrite = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setFailure('')
    try {
      await work()
      router.back()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The grant could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  const handleDelete = () => {
    if (grant === undefined || api === undefined) return
    confirmAction({
      title: `Delete ${grant.name}?`,
      message: deleteGrantDescription(grant),
      confirmLabel: 'Delete grant',
      destructive: true,
      onConfirm: () =>
        void handleWrite(() => api.accessGrants.remove.mutate({ scope, id: grant.id })),
    })
  }
  const handleMove = (key: string) => {
    const target = targets.data?.find((candidate) => scopeKeyOf(candidate.scope) === key)
    if (target === undefined || grant === undefined || api === undefined) return
    confirmAction({
      title: `Move ${grant.name}?`,
      message: `Move this grant and all its secrets and files to ${target.name}?`,
      confirmLabel: 'Move grant',
      onConfirm: () =>
        void handleWrite(async () => {
          await api.accessGrants.moveGrant.mutate({ scope, id: grant.id, target: target.scope })
        }),
    })
  }
  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="The grant could not be loaded." />
      {grant === undefined ? (
        data === null ? null : (
          <AccessNote text="This grant no longer exists. Go back to Access." />
        )
      ) : (
        <>
          <Stack.Screen options={{ title: grant.name }} />
          <AccessHeaderAction
            label="Edit grant"
            symbol="pencil"
            disabled={busy}
            onPress={() => openAccessForm({ scope, grantId: grant.id, mode: 'grant' })}
          />
          <Section title={grant.name}>
            <AccessNote>
              {grant.instruction ||
                'Add an instruction to tell the agent what this grant gives it access to.'}
            </AccessNote>
            <ActionRow
              label="Edit grant"
              onPress={() => openAccessForm({ scope, grantId: grant.id, mode: 'grant' })}
            />
          </Section>
          <Section title="Secrets">
            {grant.secrets.length === 0 ? (
              <AccessNote text="No secrets in this grant. Add one or paste a .env file." />
            ) : (
              grant.secrets.map((secret) => (
                <NavRow
                  key={secret.name}
                  label={secret.name}
                  value={formatMemoryDate(secret.updatedAt)}
                  onPress={() =>
                    openAccessForm({ scope, grantId: grant.id, mode: 'secret', name: secret.name })
                  }
                />
              ))
            )}
            <ActionRow
              label="Add secret"
              onPress={() => openAccessForm({ scope, grantId: grant.id, mode: 'secret' })}
            />
            <ActionRow
              label="Bulk add secrets"
              onPress={() => openAccessForm({ scope, grantId: grant.id, mode: 'bulk' })}
            />
          </Section>
          <Section title="Files">
            {grant.files.length === 0 ? (
              <AccessNote text="No files in this grant yet. Add a file to mount it in the sandbox." />
            ) : (
              grant.files.map((file) => (
                <NavRow
                  key={file.path}
                  label={file.path}
                  value={formatFileMode(file.mode)}
                  onPress={() =>
                    router.push({
                      pathname: '/settings/access-file',
                      params: { ...accessParamsOfScope(scope), grantId: grant.id, name: file.path },
                    })
                  }
                />
              ))
            )}
            <ActionRow
              label="Add file"
              onPress={() =>
                router.push({
                  pathname: '/settings/access-file',
                  params: { ...accessParamsOfScope(scope), grantId: grant.id },
                })
              }
            />
          </Section>
          <Section title="Move grant">
            <StatusRows
              state={targets.state}
              onRetry={targets.reload}
              failure="Move destinations could not be loaded."
            />
            {targets.data === null ? null : (
              <ChoiceRow
                label="Move to"
                value=""
                options={[
                  { label: 'Choose destination', value: '' },
                  ...targets.data.map((target) => ({
                    label: target.label,
                    value: scopeKeyOf(target.scope),
                  })),
                ]}
                onChange={handleMove}
              />
            )}
          </Section>
          {failure ? <AccessNote error>{failure}</AccessNote> : null}
          <Section>
            <ActionRow
              label="Delete grant"
              tone={EActionTone.Destructive}
              loading={busy}
              onPress={handleDelete}
            />
          </Section>
        </>
      )}
    </SettingsScroll>
  )
}
