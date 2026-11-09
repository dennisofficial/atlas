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
import { ChevronDown, Search } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import {
  type IModelOption,
  type IModelSelection,
  modelGroupsOf,
  modelTriggerLabelOf,
  personalModelLabelOf,
  pinnedModelsOf,
  searchModelsOf,
  selectionOf,
  togglePinnedModel,
  withoutPinned,
} from './model-options'
import { DefaultRow, ModelRow, ProviderMark } from './model-picker-rows'

type Props = {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinned: readonly string[]
  personalId: string
  onPinnedChange: (ids: string[]) => void
  onSelect: (selection: IModelSelection | null) => void
}

const SheetBody = ({
  models,
  selection,
  pinned,
  personalId,
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
          autoCorrect={false}
          placeholder="Search models"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        {query.trim() === '' ? (
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
  pinned,
  personalId,
  onPinnedChange,
  onSelect,
}: Props) => {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const label = modelTriggerLabelOf({ models, selection })
  const mark = selection?.model.monogram

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Model: ${label}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
      >
        {mark === undefined ? null : <ProviderMark monogram={mark} />}
        <Text size={ETextRole.Sm} numberOfLines={1} style={styles.value}>
          {label}
        </Text>
        <Icon icon={ChevronDown} color={theme.mutedForeground} size={16} />
      </Pressable>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <View
          style={[
            styles.overlay,
            { backgroundColor: withAlpha({ color: '#000000', alpha: 0.35 }) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the model menu"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.popover,
                borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
              },
            ]}
          >
            <SheetBody
              models={models}
              selection={selection}
              pinned={pinned}
              personalId={personalId}
              onPinnedChange={onPinnedChange}
              onSelect={onSelect}
              onClose={() => setOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(1.5),
    height: 28,
    maxWidth: 200,
    paddingHorizontal: space(2),
  },
  value: {
    flexShrink: 1,
  },
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    padding: space(3),
  },
  sheet: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    elevation: 8,
    maxHeight: 460,
    maxWidth: 480,
    padding: space(1),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  search: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(1.5),
    margin: space(1),
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
