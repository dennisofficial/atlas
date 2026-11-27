import {
  ETextRole,
  ETextTone,
  Icon,
  Input,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Search } from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import {
  type IModelOption,
  type IModelSelection,
  modelGroupsOf,
  personalModelLabelOf,
  pinnedModelsOf,
  searchModelsOf,
  selectionOf,
  togglePinnedModel,
  withoutPinned,
} from './model-options'
import { DefaultRow, ModelRow } from './model-picker-rows'
import { presentModelSheet } from './model-sheet-request'
import { ModelTrigger } from './model-trigger'

type Props = {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinned: readonly string[]
  personalId: string
  defaultRow?: boolean | undefined
  onPinnedChange: (ids: string[]) => void
  onSelect: (selection: IModelSelection | null) => void
}

export const ModelListBody = ({
  models,
  selection,
  pinned,
  personalId,
  defaultRow = true,
  onPinnedChange,
  onSelect,
  onClose,
}: Props & { onClose: () => void }) => {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const pinnedShown = searchModelsOf({ models: pinnedModelsOf({ models, pinned }), query })
  const groups = modelGroupsOf(searchModelsOf({ models: withoutPinned({ models, pinned }), query }))
  const personalLabel = personalModelLabelOf({ models, personalId })

  const handleModel = (model: IModelOption) => {
    const next = selectionOf({
      models,
      modelId: model.id,
      effort: selection?.effort ?? null,
      fast: selection?.fast ?? false,
    })
    if (next === null) return
    onSelect(next)
    onClose()
  }

  const handleDefault = () => {
    onSelect(null)
    onClose()
  }

  const handlePin = (id: string) => onPinnedChange(togglePinnedModel({ pinned, id }))

  const row = (model: IModelOption) => (
    <ModelRow
      key={model.id}
      model={model}
      selected={model.id === selection?.model.id}
      pinned={pinned.includes(model.id)}
      onTogglePin={() => handlePin(model.id)}
      onPress={() => handleModel(model)}
    />
  )

  const nothingMatches = groups.length === 0 && pinnedShown.length === 0

  return (
    <>
      <View
        style={[
          styles.search,
          { borderColor: withAlpha({ color: theme.foreground, alpha: 0.12 }) },
        ]}
      >
        <Icon icon={Search} color={theme.mutedForeground} size={14} />
        <Input
          bare
          accessibilityLabel="Search models"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder="Search models"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
      </View>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.list}
      >
        {defaultRow && query.trim() === '' ? (
          <DefaultRow label={personalLabel} selected={selection === null} onPress={handleDefault} />
        ) : null}
        {models.length === 0 ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.empty}>
            No models yet
          </Text>
        ) : null}
        {models.length > 0 && nothingMatches ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.empty}>
            No models match
          </Text>
        ) : null}
        {pinnedShown.length === 0 ? null : (
          <View>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.group}>
              Pinned
            </Text>
            {pinnedShown.map(row)}
          </View>
        )}
        {groups.map((group) => (
          <View key={group.providerId}>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.group}>
              {group.provider}
            </Text>
            {group.models.map(row)}
          </View>
        ))}
      </ScrollView>
    </>
  )
}

export const ModelSelect = ({
  models,
  selection,
  pinnedRef,
  personalId,
  defaultRow = true,
  onSelect,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinnedRef?: string | null | undefined
  personalId: string
  defaultRow?: boolean | undefined
  onSelect: (selection: IModelSelection | null) => void
}) => {
  const handleOpen = () =>
    presentModelSheet({ models, selection, personalId, defaultRow, onSelect })

  return (
    <ModelTrigger
      models={models}
      selection={selection}
      pinnedRef={pinnedRef}
      onPress={handleOpen}
    />
  )
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  search: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(1.5),
    marginHorizontal: space(3),
    marginVertical: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: 20,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  group: {
    paddingBottom: space(1),
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
  empty: {
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
})
