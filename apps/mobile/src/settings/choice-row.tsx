import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { Pressable, StyleSheet, View } from 'react-native'

import type { IChoiceRowProps } from './choice-row-props'

export const ChoiceRow = <T,>({ label, detail, value, options, onChange }: IChoiceRowProps<T>) => {
  const index = options.findIndex((option) => option.value === value)
  const current = index === -1 ? undefined : options[index]

  const handlePress = () => {
    if (options.length === 0) return
    const next = options[(index + 1) % options.length]
    if (next !== undefined) onChange(next.value)
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${current?.label ?? 'None'}`}
      onPress={handlePress}
    >
      <CardRow>
        <View style={styles.copy}>
          <Text size={ETextRole.Sm}>{label}</Text>
          {detail === undefined ? null : (
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              {detail}
            </Text>
          )}
        </View>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {current?.label ?? 'None'}
        </Text>
      </CardRow>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
})
