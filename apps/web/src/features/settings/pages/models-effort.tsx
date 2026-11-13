'use client'

import { useMemo } from 'react'
import { z } from 'zod'

import { refKey, roleKey, type EEffort, type ModelRole } from '@dltech/atlas-core'

import { providerNameOf } from '@/features/threads/data/model-options'
import { useModelPicker, type ModelPicker } from '@/features/threads/data/use-model-picker'
import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { choiceOf, currentModelIds, resolveRoles, staleOwnerOf } from '../data/personal/model-roles'
import {
  effortDraft,
  fastDraft,
  followedDraft,
  modelsChanges,
  modelsDraftFrom,
  pickedModelDraft,
} from '../data/personal/models-settings'
import { QueryPage } from '../data/personal/query-boundary'
import { usePersonalSettings, useSettingsDraft } from '../data/personal/use-settings-draft'
import { ModelsSkeleton } from '../skeletons/agent-skeletons'
import { ConfigFooter } from '../parts/agent-config-footer'
import { ProviderAlert } from '../parts/models/provider-alert'
import { ProvidersEmpty } from '../parts/models/providers-empty'
import { ROLE_GROUPS } from '../parts/models/role-groups'
import { RoleRow } from '../parts/models/role-row'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Models & Effort'
const DESCRIPTION = 'Choose which model each part of the agent runs on and how hard it thinks.'

export function ModelsEffortPage() {
  const settings = usePersonalSettings()
  const { read } = settings
  const currentIds = useMemo(
    () => currentModelIds((args) => read({ ...args, schema: z.string() })),
    [read],
  )
  const picker = useModelPicker({ currentIds })
  return (
    <QueryPage
      query={settings.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<ModelsSkeleton />}
    >
      {(values) => <ModelsEditor values={values} save={settings.save} picker={picker} />}
    </QueryPage>
  )
}

export function ModelsEditor({
  values,
  save,
  picker,
}: {
  values: SettingValues
  save: (changes: SettingChanges) => Promise<void>
  picker: ModelPicker
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: modelsDraftFrom,
    toChanges: modelsChanges,
    save,
  })
  const { value, setValue } = draft
  const models = picker.options.models
  const choices = useMemo(() => resolveRoles({ draft: value, models }), [value, models])
  const owner = staleOwnerOf(choices)
  const dirty = draft.dirty && !saving
  const expired =
    owner !== undefined &&
    picker.options.reconnectProviders.includes(providerNameOf(owner.choice.ref.providerId))

  const handleChooseModel = ({ role, model }: { role: ModelRole; model: string }) =>
    setValue(
      pickedModelDraft({
        draft: value,
        role,
        model,
        option: models.find((candidate) => candidate.id === model),
        inherited: choiceOf({ choices, role }),
      }),
    )
  const handleChooseEffort = ({ role, effort }: { role: ModelRole; effort: EEffort }) =>
    setValue(effortDraft({ draft: value, role, effort }))
  const handleToggleFast = ({ role, fast }: { role: ModelRole; fast: boolean }) =>
    setValue(fastDraft({ draft: value, role, fast }))
  const handleFollow = ({ role }: { role: ModelRole }) =>
    setValue(followedDraft({ draft: value, role }))

  if (!picker.ready) return <ModelsSkeleton />
  if (models.length === 0)
    return (
      <SettingsPage title={TITLE} description={DESCRIPTION}>
        <ProvidersEmpty />
      </SettingsPage>
    )

  const actions = {
    chooseModel: handleChooseModel,
    chooseEffort: handleChooseEffort,
    toggleFast: handleToggleFast,
    follow: handleFollow,
  }

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      {owner === undefined ? null : (
        <ProviderAlert
          owner={owner}
          choices={choices}
          label={
            models.find((model) => model.id === refKey(owner.choice.ref))?.label ??
            owner.choice.ref.modelId
          }
          expired={expired}
          onChoose={() => setValue(followedDraft({ draft: value, role: owner.role }))}
        />
      )}
      {ROLE_GROUPS.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          <SettingsCard>
            {group.roles.map((role) => (
              <RoleRow
                key={roleKey(role)}
                role={role}
                choice={choiceOf({ choices, role })}
                picker={picker}
                actions={actions}
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      ))}
      <ConfigFooter dirty={dirty} onDiscard={draft.discard} onSave={() => void handleSave()} />
    </SettingsPage>
  )
}
