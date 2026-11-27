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
import { SectionList, StyleSheet, View } from 'react-native'

import {
  hasModelMatchesOf,
  modelListSectionsOf,
  type TModelListItem,
  type TModelListSection,
} from './model-list-sections'
import {
  type IModelOption,
  type IModelSelection,
  selectionOf,
  togglePinnedModel,
} from './model-options'
import { ModelRow } from './model-picker-rows'
import { presentModelSheet } from './model-sheet-request'
import { ModelTrigger } from './model-trigger'

const INITIAL_ROWS = 12

type Props = {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinned: readonly string[]
  onPinnedChange: (ids: string[]) => void
  onSelect: (selection: IModelSelection) => void
}

export const ModelListBody = ({
  models,
  selection,
  pinned,
  onPinnedChange,
  onSelect,
  onClose,
}: Props & { onClose: () => void }) => {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const sections = modelListSectionsOf({ models, pinned, query })

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

  const handlePin = (id: string) => onPinnedChange(togglePinnedModel({ pinned, id }))

  const renderItem = ({ item }: { item: TModelListItem }) => (
    <ModelRow
      model={item.model}
      selected={item.model.id === selection?.model.id}
      pinned={pinned.includes(item.model.id)}
      onTogglePin={() => handlePin(item.model.id)}
      onPress={() => handleModel(item.model)}
    />
  )

  const renderSectionHeader = ({ section }: { section: TModelListSection }) => (
    <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.group}>
      {section.title}
    </Text>
  )

  const emptyNote = models.length === 0 ? 'No models yet' : 'No models match'

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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        initialNumToRender={INITIAL_ROWS}
        maxToRenderPerBatch={INITIAL_ROWS}
        windowSize={5}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        ListFooterComponent={
          hasModelMatchesOf(sections) ? undefined : (
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.empty}>
              {emptyNote}
            </Text>
          )
        }
      />
    </>
  )
}

export const ModelSelect = ({
  models,
  selection,
  pinnedRef,
  onSelect,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinnedRef?: string | null | undefined
  onSelect: (selection: IModelSelection) => void
}) => {
  const handleOpen = () => presentModelSheet({ models, selection, onSelect })

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
