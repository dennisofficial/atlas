import {
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Check, Zap } from 'lucide-react-native'
import { Pressable, StyleSheet, Switch, View } from 'react-native'

import { effortLabelOf, type IModelOption, type IModelSelection } from './model-options'

export const ProviderMark = ({ monogram }: { monogram: string }) => {
  const theme = useTheme()
  return (
    <View style={[styles.mark, { backgroundColor: theme.muted }]}>
      <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
        {monogram}
      </Text>
    </View>
  )
}

export const ModelRow = ({
  model,
  selected,
  onPress,
}: {
  model: IModelOption
  selected: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
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
      <ProviderMark monogram={model.monogram} />
      <Text size={ETextRole.Sm} numberOfLines={1} style={styles.rowLabel}>
        {model.label}
      </Text>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.context}>
        {model.context}
      </Text>
      {model.note === null && model.rate === null ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.rate}>
          {model.note ?? model.rate}
        </Text>
      )}
      {selected ? <Icon icon={Check} color={theme.foreground} size={16} /> : null}
    </Pressable>
  )
}

export const EffortChip = ({
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

export const FastRow = ({
  selection,
  onToggle,
}: {
  selection: IModelSelection
  onToggle: (fast: boolean) => void
}) => {
  const theme = useTheme()
  return (
    <View style={styles.fastRow}>
      <Icon icon={Zap} color={theme.mutedForeground} size={14} />
      <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.fastLabel}>
        Fast
      </Text>
      <Switch
        accessibilityLabel="Fast"
        value={selection.fast}
        onValueChange={onToggle}
        trackColor={{ false: theme.input, true: theme.primary }}
        thumbColor={theme.background}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    borderRadius: radius(0.4),
    height: 20,
    justifyContent: 'center',
    width: 20,
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
  context: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    width: 40,
  },
  rate: {
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    width: 68,
  },
  chip: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
  },
  fastRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
    paddingHorizontal: space(2),
    paddingBottom: space(2),
  },
  fastLabel: {
    flex: 1,
  },
})
