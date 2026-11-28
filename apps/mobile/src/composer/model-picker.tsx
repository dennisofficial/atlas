import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
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
import { ModelSearchField } from './model-search-field'
import { presentModelSheet } from './model-sheet-request'
import { ModelTrigger } from './model-trigger'

const INITIAL_ROWS = 12

export type TRowInsets = { left: number; right: number }

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
  query,
  rowInsets,
  onQueryChange,
  onClose,
}: Props & {
  query: string
  rowInsets: TRowInsets
  onQueryChange: (query: string) => void
  onClose: () => void
}) => {
  const sections = modelListSectionsOf({ models, pinned, query })
  const insetStyle = { marginLeft: rowInsets.left, marginRight: rowInsets.right }

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
    <View style={insetStyle}>
      <ModelRow
        model={item.model}
        selected={item.model.id === selection?.model.id}
        pinned={pinned.includes(item.model.id)}
        onTogglePin={() => handlePin(item.model.id)}
        onPress={() => handleModel(item.model)}
      />
    </View>
  )

  const renderSectionHeader = ({ section }: { section: TModelListSection }) => (
    <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={[styles.group, insetStyle]}>
      {section.title}
    </Text>
  )

  const emptyNote = models.length === 0 ? 'No models yet' : 'No models match'

  return (
    <SectionList
      scrollsToTop={false}
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
      ListHeaderComponent={
        <ModelSearchField query={query} sideInsets={rowInsets} onQueryChange={onQueryChange} />
      }
      ListFooterComponent={
        hasModelMatchesOf(sections) ? undefined : (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={[styles.empty, insetStyle]}>
            {emptyNote}
          </Text>
        )
      }
    />
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
  group: {
    paddingBottom: space(1),
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
  empty: {
    paddingHorizontal: space(2),
    paddingVertical: space(3),
  },
})
