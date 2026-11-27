import {
  ROLE_GROUPS,
  choiceOf,
  effortDraft,
  fastDraft,
  followedDraft,
  modelsChanges,
  modelsDraftFrom,
  ownsModel,
  pickedModelDraft,
  resolveRoles,
  roleTitleOf,
  staleOwnerOf,
  type IModelsDraft,
} from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { ModelRole } from '@dltech/atlas-core'
import { StyleSheet } from 'react-native'

import { useModels } from '../../../composer/use-models'
import { EResourceState } from '../../../settings/api-resource-state'
import { ModelRoleRow } from '../../../settings/model-role-row'
import { Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'

export default function ModelsEffortScreen() {
  const settings = useSettings()
  const { models, ready, failed } = useModels()
  const draft = modelsDraftFrom(settings.values)
  const choices = resolveRoles({ draft, models })
  const owner = staleOwnerOf(choices)

  const save = (next: IModelsDraft) => {
    void settings.save(modelsChanges({ saved: draft, draft: next })).catch(() => undefined)
  }

  const handleChooseModel = (args: { role: ModelRole; model: string }) =>
    save(
      pickedModelDraft({
        draft,
        role: args.role,
        model: args.model,
        option: models.find((candidate) => candidate.id === args.model),
        inherited: choiceOf({ choices, role: args.role }),
      }),
    )
  const handleChooseEffort = (args: { role: ModelRole; effort: string }) =>
    save(effortDraft({ draft, role: args.role, effort: args.effort }))
  const handleToggleFast = (args: { role: ModelRole; fast: boolean }) =>
    save(fastDraft({ draft, role: args.role, fast: args.fast }))
  const handleFollow = (args: { role: ModelRole }) =>
    save(followedDraft({ draft, role: args.role }))

  if (failed && models.length === 0) {
    return (
      <SettingsScroll>
        <Section>
          <StatusRows state={EResourceState.Failed} />
        </Section>
      </SettingsScroll>
    )
  }
  if (!ready) {
    return (
      <SettingsScroll>
        <Section>
          <StatusRows state={EResourceState.Loading} />
        </Section>
      </SettingsScroll>
    )
  }
  if (models.length === 0) {
    return (
      <SettingsScroll>
        <Section title="Models">
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              No provider is connected yet. Add one in Settings, then pick a model for each role
              here.
            </Text>
          </CardRow>
        </Section>
      </SettingsScroll>
    )
  }

  return (
    <SettingsScroll>
      {owner === undefined ? null : (
        <Section title="Attention">
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.alert}>
              {`${roleTitleOf(owner.role)} is set to a model this account cannot reach. Everything that follows it is affected too.`}
            </Text>
          </CardRow>
        </Section>
      )}
      {ROLE_GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.roles.map((role) => (
            <ModelRoleRow
              key={roleTitleOf(role)}
              role={role}
              choice={choiceOf({ choices, role })}
              models={models}
              following={!ownsModel(choiceOf({ choices, role }))}
              onChooseModel={(model) => handleChooseModel({ role, model })}
              onChooseEffort={(effort) => handleChooseEffort({ role, effort })}
              onToggleFast={(fast) => handleToggleFast({ role, fast })}
              onFollow={() => handleFollow({ role })}
            />
          ))}
        </Section>
      ))}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  alert: {
    flexShrink: 1,
    gap: space(1),
  },
})
