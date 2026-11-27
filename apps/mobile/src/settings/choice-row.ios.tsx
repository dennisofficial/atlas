import { CardRow, ETextRole, Text, useIsDark } from '@dltech/atlas-ui-native'
import { Button, Host, Menu } from '@expo/ui/swift-ui'
import { buttonStyle, menuIndicator } from '@expo/ui/swift-ui/modifiers'

import type { IChoiceRowProps } from './choice-row-props'

export const ChoiceRow = <T,>({ label, value, options, onChange }: IChoiceRowProps<T>) => {
  const dark = useIsDark()
  const current = options.find((option) => option.value === value)

  return (
    <CardRow>
      <Text size={ETextRole.Sm}>{label}</Text>
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
