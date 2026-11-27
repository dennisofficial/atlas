import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { Pressable } from 'react-native'

import type { IChoiceRowProps } from './choice-row-props'

export const ChoiceRow = <T,>({ label, value, options, onChange }: IChoiceRowProps<T>) => {
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
        <Text size={ETextRole.Sm}>{label}</Text>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {current?.label ?? 'None'}
        </Text>
      </CardRow>
    </Pressable>
  )
}
