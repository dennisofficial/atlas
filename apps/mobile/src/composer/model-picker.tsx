import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
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
import { type ReactNode, useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

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

const ModelListBody = ({
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
          autoCorrect={false}
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

const ModelSheet = ({ open, onClose, ...body }: Props & { open: boolean; onClose: () => void }) => (
  <Modal
    visible={open}
    animationType="slide"
    presentationStyle="pageSheet"
    onRequestClose={onClose}
  >
    <SafeAreaProvider>
      <ModelSheetFrame onClose={onClose}>
        <ModelListBody {...body} onClose={onClose} />
      </ModelSheetFrame>
    </SafeAreaProvider>
  </Modal>
)

const ModelSheetFrame = ({ onClose, children }: { onClose: () => void; children: ReactNode }) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.frame,
        {
          backgroundColor: theme.background,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={styles.bar}>
        <Text size={ETextRole.Base} weight={EFontWeight.Semibold} style={styles.title}>
          Model
        </Text>
        <Button
          label="Done"
          variant={EButtonVariant.Ghost}
          size={EButtonSize.Sm}
          onPress={onClose}
        />
      </View>
      {children}
    </View>
  )
}

export const ModelSelect = ({
  pinnedRef,
  open: controlledOpen,
  onOpenChange,
  ...body
}: Props & {
  pinnedRef?: string | null | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) => {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = controlledOpen ?? ownOpen

  const handleOpenChange = (next: boolean) => {
    setOwnOpen(next)
    onOpenChange?.(next)
  }

  const handleOpen = () => handleOpenChange(true)

  const handleClose = () => handleOpenChange(false)

  return (
    <>
      <ModelTrigger
        models={body.models}
        selection={body.selection}
        pinnedRef={pinnedRef}
        expanded={open}
        onPress={handleOpen}
      />
      <ModelSheet {...body} open={open} onClose={handleClose} />
    </>
  )
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingLeft: space(4),
    paddingRight: space(2),
    paddingTop: space(3),
  },
  title: {
    flex: 1,
  },
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
