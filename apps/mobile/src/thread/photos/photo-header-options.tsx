import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  Text,
} from '@dltech/atlas-ui-native'
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router'
import { Platform } from 'react-native'

import type { TPosture } from '../../layout/posture'
import { leadingHeaderOptionsOf } from '../../navigation/header-options'

const HIDDEN_EDGES = { top: 'hidden', bottom: 'hidden', left: 'hidden', right: 'hidden' } as const

const closeItemOf = (onPress: () => void): NativeStackHeaderItem => ({
  type: 'button',
  label: 'Close',
  icon: { type: 'sfSymbol', name: 'xmark' },
  accessibilityLabel: 'Close the photo',
  onPress,
  hidesSharedBackground: false,
})

const shareItemOf = (onPress: () => void): NativeStackHeaderItem => ({
  type: 'button',
  label: 'Share',
  icon: { type: 'sfSymbol', name: 'square.and.arrow.up' },
  accessibilityLabel: 'Share the photo',
  onPress,
  hidesSharedBackground: false,
})

const PhotoTitle = ({ name }: { name: string }) => (
  <Text size={ETextRole.Sm} weight={EFontWeight.Medium} numberOfLines={1} ellipsizeMode="middle">
    {name}
  </Text>
)

export const photoHeaderOptionsOf = ({
  name,
  posture,
  windowWidth,
  tint,
  onClose,
  onShare,
}: {
  name: string | undefined
  posture: TPosture
  windowWidth: number
  tint: string
  onClose: () => void
  onShare: () => void
}): NativeStackNavigationOptions => {
  const base: NativeStackNavigationOptions = {
    headerShown: true,
    headerTransparent: true,
    headerShadowVisible: false,
    headerTintColor: tint,
    scrollEdgeEffects: HIDDEN_EDGES,
  }
  if (Platform.OS !== 'ios')
    return {
      ...base,
      title: name ?? 'Photo',
      headerLeft: () => (
        <Button
          label="Close"
          variant={EButtonVariant.Ghost}
          size={EButtonSize.Sm}
          onPress={onClose}
        />
      ),
      headerRight: () =>
        name === undefined ? null : (
          <Button
            label="Share"
            variant={EButtonVariant.Ghost}
            size={EButtonSize.Sm}
            onPress={onShare}
          />
        ),
    }
  const shareItems = name === undefined ? [] : [shareItemOf(onShare)]
  if (name === undefined)
    return {
      ...base,
      title: '',
      unstable_headerLeftItems: () => [closeItemOf(onClose)],
      unstable_headerRightItems: () => shareItems,
    }
  return {
    ...base,
    title: name,
    ...leadingHeaderOptionsOf({
      leading: [closeItemOf(onClose)],
      title: <PhotoTitle name={name} />,
      glassTitle: true,
      titleButtons: 2,
      windowWidth,
      posture,
    }),
    unstable_headerRightItems: () => shareItems,
  }
}
