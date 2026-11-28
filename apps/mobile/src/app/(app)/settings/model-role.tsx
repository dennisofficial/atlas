import {
  PAGE_ROLES,
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
  unfollowedDraft,
  type IModelsDraft,
} from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { parentRoleOf, refKey, roleKey } from '@dltech/atlas-core'
import { Stack, useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { EffortSelect } from '../../../composer/effort-select'
import {
  effortLabelOf,
  modelTriggerLabelOf,
  type IModelSelection,
  selectionOf,
} from '../../../composer/model-options'
import { ModelSelect } from '../../../composer/model-picker'
import { useModels } from '../../../composer/use-models'
import { useContentWidth } from '../../../layout/use-content-width'
import { pushedHeaderOptionsOf } from '../../../navigation/header-options'
import { EResourceState } from '../../../settings/api-resource-state'
import { Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'
import { SwitchRow } from '../../../settings/switch-row'

export default function ModelRoleScreen() {
  const params = useLocalSearchParams<{ role?: string }>()
  const role = PAGE_ROLES.find((candidate) => roleKey(candidate) === params.role)
  const settings = useSettings()
  const { models, ready, failed } = useModels()
  const barWidth = useContentWidth()
  const title = role === undefined ? 'Model' : roleTitleOf(role)
  const header = <Stack.Screen options={pushedHeaderOptionsOf({ title, barWidth })} />

  if (role === undefined) {
    return (
      <SettingsScroll>
        {header}
        <Section>
          <StatusRows state={EResourceState.Failed} failure="This model role does not exist." />
        </Section>
      </SettingsScroll>
    )
  }
  if (!settings.ready || !ready || (failed && models.length === 0)) {
    return (
      <SettingsScroll>
        {header}
        <Section>
          <StatusRows
            state={settings.failed || failed ? EResourceState.Failed : EResourceState.Loading}
          />
        </Section>
      </SettingsScroll>
    )
  }
  if (models.length === 0) {
    return (
      <SettingsScroll>
        {header}
        <Section>
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              No provider is connected yet. Add one in Settings, then pick a model here.
            </Text>
          </CardRow>
        </Section>
      </SettingsScroll>
    )
  }

  const draft = modelsDraftFrom(settings.values)
  const choices = resolveRoles({ draft, models })
  const choice = choiceOf({ choices, role })
  const following = !ownsModel(choice)
  const parent = parentRoleOf(role)
  const modelId = refKey(choice.ref)
  const selection = selectionOf({ models, modelId, effort: choice.effort, fast: choice.fast })

  const save = (next: IModelsDraft) => {
    void settings.save(modelsChanges({ saved: draft, draft: next })).catch(() => undefined)
  }
  const handleChooseModel = (next: IModelSelection) => {
    save(
      pickedModelDraft({
        draft,
        role,
        model: next.model.id,
        option: next.model,
        inherited: choice,
      }),
    )
  }
  const handleChooseEffort = (effort: string) => save(effortDraft({ draft, role, effort }))
  const handleToggleFast = (fast: boolean) => save(fastDraft({ draft, role, fast }))
  const handleFollow = (next: boolean) => {
    save(
      next ? followedDraft({ draft, role }) : unfollowedDraft({ draft, role, inherited: choice }),
    )
  }

  return (
    <SettingsScroll>
      {header}
      {parent === undefined ? null : (
        <Section>
          <SwitchRow
            label={`Follow ${roleTitleOf(parent).toLowerCase()}`}
            value={following}
            onValueChange={handleFollow}
          />
        </Section>
      )}
      <View
        pointerEvents={following ? 'none' : 'auto'}
        accessibilityState={{ disabled: following }}
        style={following ? styles.inherited : undefined}
      >
        <Section>
          <CardRow>
            <Text size={ETextRole.Sm}>Model</Text>
            <View style={styles.control}>
              {following ? (
                <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={1}>
                  {modelTriggerLabelOf({ models, selection, ref: modelId })}
                </Text>
              ) : (
                <ModelSelect
                  models={models}
                  selection={selection}
                  pinnedRef={modelId}
                  onSelect={handleChooseModel}
                />
              )}
            </View>
          </CardRow>
          <CardRow>
            <Text size={ETextRole.Sm}>Effort</Text>
            <View style={styles.effort}>
              <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                {effortLabelOf(choice.effort)}
              </Text>
              {following || selection === null ? null : (
                <EffortSelect selection={selection} onChange={handleChooseEffort} />
              )}
            </View>
          </CardRow>
          {selection?.model.fast !== true ? null : (
            <SwitchRow
              label="Fast"
              detail="Prefer the faster variant"
              value={choice.fast}
              onValueChange={handleToggleFast}
              disabled={following}
            />
          )}
        </Section>
      </View>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  inherited: {
    opacity: 0.5,
  },
  control: {
    flexShrink: 1,
    minWidth: 0,
  },
  effort: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1),
  },
})
