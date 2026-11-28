import { followNoteOf, roleTitleOf } from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { parentRoleOf, refKey, type ModelRole, type ResolvedModelChoice } from '@dltech/atlas-core'
import { StyleSheet, Switch, View } from 'react-native'

import { EffortSelect } from '../composer/effort-select'
import { type IModelOption, type IModelSelection, selectionOf } from '../composer/model-options'
import { ModelSelect } from '../composer/model-picker'

export const ModelRoleRow = ({
  role,
  choice,
  models,
  following,
  onChooseModel,
  onChooseEffort,
  onToggleFast,
  onFollow,
}: {
  role: ModelRole
  choice: ResolvedModelChoice
  models: readonly IModelOption[]
  following: boolean
  onChooseModel: (model: string) => void
  onChooseEffort: (effort: string) => void
  onToggleFast: (fast: boolean) => void
  onFollow: () => void
}) => {
  const modelId = choice.ref.modelId === '' ? null : refKey(choice.ref)
  const selection = selectionOf({ models, modelId, effort: choice.effort, fast: choice.fast })
  const parent = parentRoleOf(role)
  const note = following ? (followNoteOf(role) ?? roleTitleOf(role)) : undefined

  const handleSelect = (next: IModelSelection) => {
    if (next.model.id !== selection?.model.id) {
      onChooseModel(next.model.id)
      return
    }
    if (next.effort !== selection?.effort) {
      onChooseEffort(next.effort)
      return
    }
    if (next.fast !== selection?.fast) onToggleFast(next.fast)
  }

  const handleFollow = (next: boolean) => {
    if (next) onFollow()
  }

  return (
    <CardRow>
      <View style={styles.copy}>
        <Text size={ETextRole.Sm}>{roleTitleOf(role)}</Text>
        {note === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            {note}
          </Text>
        )}
      </View>
      <View style={styles.controls}>
        <ModelSelect models={models} selection={selection} onSelect={handleSelect} />
        {selection === null ? null : (
          <EffortSelect selection={selection} onChange={onChooseEffort} />
        )}
        {selection?.model.fast !== true ? null : (
          <Switch
            accessibilityLabel={`Fast for ${roleTitleOf(role)}`}
            value={choice.fast}
            onValueChange={onToggleFast}
          />
        )}
        {parent === undefined ? null : (
          <Switch
            accessibilityLabel={`Follow ${roleTitleOf(parent).toLowerCase()}`}
            value={following}
            onValueChange={handleFollow}
          />
        )}
      </View>
    </CardRow>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: space(2),
  },
})
