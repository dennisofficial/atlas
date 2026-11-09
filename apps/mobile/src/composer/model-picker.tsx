import { ETextRole, ETextTone, Icon, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Check, ChevronDown, Sparkles } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import {
  effortLabelOf,
  effortChoicesOf,
  type IModelOption,
  type IModelSelection,
  modelTriggerLabelOf,
  selectionOf,
} from './model-options'

const ModelRow = ({
  model,
  selected,
  onPress,
}: {
  model: IModelOption
  selected: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
  const meta = model.note ?? model.context
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model.label}
      accessibilityState={{ disabled: model.disabled, selected }}
      disabled={model.disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { opacity: model.disabled ? 0.5 : 1 },
        pressed ? { backgroundColor: theme.accent } : null,
      ]}
    >
      <Text size={ETextRole.Sm} numberOfLines={1} style={styles.rowLabel}>
        {model.label}
      </Text>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
        {meta}
      </Text>
      {selected ? <Icon icon={Check} color={theme.foreground} size={16} /> : null}
    </Pressable>
  )
}

const EffortChip = ({
  name,
  active,
  onPress,
}: {
  name: string
  active: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={effortLabelOf(name)}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.accent : 'transparent',
          borderColor: withAlpha({ color: theme.foreground, alpha: active ? 0 : 0.18 }),
        },
        pressed ? { backgroundColor: theme.accent } : null,
      ]}
    >
      <Text size={ETextRole.Xs} {...(active ? {} : { tone: ETextTone.Muted })}>
        {effortLabelOf(name)}
      </Text>
    </Pressable>
  )
}

const groupsOf = (
  models: readonly IModelOption[],
): readonly { provider: string; models: readonly IModelOption[] }[] =>
  models.reduce<{ provider: string; models: IModelOption[] }[]>((groups, model) => {
    const last = groups.at(-1)
    if (last !== undefined && last.provider === model.provider) {
      last.models.push(model)
      return groups
    }
    groups.push({ provider: model.provider, models: [model] })
    return groups
  }, [])

export const ModelSelect = ({
  models,
  selection,
  onSelect,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  onSelect: (selection: IModelSelection) => void
}) => {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const label = modelTriggerLabelOf({ models, selection })
  const efforts = effortChoicesOf(selection)
  const groups = groupsOf(models)

  const handleModel = (model: IModelOption) => {
    const next = selectionOf({ models, modelId: model.id, effort: selection?.effort ?? null })
    if (next === null) return
    onSelect(next)
    setOpen(false)
  }

  const handleEffort = (name: string) => {
    if (selection === null) return
    onSelect({ model: selection.model, effort: name })
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Model: ${label}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
      >
        <Icon icon={Sparkles} color={theme.foreground} size={16} />
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
            {models.length === 0 ? (
              <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.empty}>
                No models yet
              </Text>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                {groups.map((group) => (
                  <View key={group.provider}>
                    <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.group}>
                      {group.provider}
                    </Text>
                    {group.models.map((model) => (
                      <ModelRow
                        key={model.id}
                        model={model}
                        selected={model.id === selection?.model.id}
                        onPress={() => handleModel(model)}
                      />
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}
            {efforts.length === 0 ? null : (
              <View style={styles.efforts}>
                {efforts.map((effort) => (
                  <EffortChip
                    key={effort}
                    name={effort}
                    active={effort === selection?.effort}
                    onPress={() => handleEffort(effort)}
                  />
                ))}
              </View>
            )}
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
    paddingLeft: space(2.5),
    paddingRight: space(2),
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
    maxHeight: 420,
    maxWidth: 480,
    padding: space(1),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  group: {
    paddingHorizontal: space(2),
    paddingTop: space(2),
    paddingBottom: space(1),
  },
  row: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
  rowLabel: {
    flex: 1,
  },
  efforts: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127, 127, 127, 0.25)',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1.5),
    padding: space(2),
  },
  chip: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
  },
  empty: {
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
})
