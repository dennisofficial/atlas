import { CardRow, ETextRole, ETextTone, Text, useIsDark } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { Button, Host, Menu } from '@expo/ui/swift-ui'
import { buttonStyle, menuIndicator } from '@expo/ui/swift-ui/modifiers'
import { StyleSheet, View } from 'react-native'

import type { IChoiceRowProps } from './choice-row-props'

export const ChoiceRow = <T,>({ label, detail, value, options, onChange }: IChoiceRowProps<T>) => {
  const dark = useIsDark()
  const current = options.find((option) => option.value === value)

  return (
    <CardRow>
      <View style={styles.copy}>
        <Text size={ETextRole.Sm}>{label}</Text>
        {detail === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            {detail}
          </Text>
        )}
      </View>
      <Host colorScheme={dark ? 'dark' : 'light'} matchContents alignment="trailing">
        <Menu
          label={current?.label ?? 'None'}
          modifiers={[buttonStyle('plain'), menuIndicator('hidden')]}
        >
          {options.map((option) => (
            <Button
              key={option.label}
              label={option.label}
              onPress={() => onChange(option.value)}
            />
          ))}
        </Menu>
      </Host>
    </CardRow>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
})
