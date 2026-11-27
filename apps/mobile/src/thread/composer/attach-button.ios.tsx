import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Button, Host, Image, Menu, type ButtonProps } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  menuIndicator,
} from '@expo/ui/swift-ui/modifiers'
import { StyleSheet } from 'react-native'

import { ATTACH_SOURCES, type AttachButtonProps, EAttachSource } from './attach-sources'

const SIZE = 32

const SYMBOL: Record<EAttachSource, ButtonProps['systemImage']> = {
  [EAttachSource.Camera]: 'camera',
  [EAttachSource.Library]: 'photo.on.rectangle',
  [EAttachSource.File]: 'folder',
}

export const AttachButton = ({ onPick }: AttachButtonProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  return (
    <Host colorScheme={dark ? 'dark' : 'light'} alignment="center" style={styles.host}>
      <Menu
        label={<Image systemName="plus" size={16} color={theme.foreground} />}
        modifiers={[
          accessibilityLabel('Attach a file'),
          buttonStyle('bordered'),
          buttonBorderShape('circle'),
          menuIndicator('hidden'),
        ]}
      >
        {ATTACH_SOURCES.map((option) => (
          <Button
            key={option.source}
            label={option.label}
            systemImage={SYMBOL[option.source]}
            onPress={() => onPick(option.source)}
          />
        ))}
      </Menu>
    </Host>
  )
}

const styles = StyleSheet.create({
  host: {
    height: SIZE,
    width: SIZE,
  },
})
