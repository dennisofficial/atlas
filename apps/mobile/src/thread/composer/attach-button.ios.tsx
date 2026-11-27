import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Button, Host, Image, Menu, type ButtonProps } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  frame,
  menuIndicator,
} from '@expo/ui/swift-ui/modifiers'
import { StyleSheet, View } from 'react-native'

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
    <View style={styles.box}>
      <Host colorScheme={dark ? 'dark' : 'light'} alignment="center" style={styles.fill}>
        <Menu
          label={<Image systemName="plus" size={16} color={theme.foreground} />}
          modifiers={[
            accessibilityLabel('Attach a file'),
            buttonStyle('bordered'),
            buttonBorderShape('circle'),
            menuIndicator('hidden'),
            frame({ width: SIZE, height: SIZE, alignment: 'center' }),
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
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'center',
    height: SIZE,
    width: SIZE,
  },
  fill: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
})
