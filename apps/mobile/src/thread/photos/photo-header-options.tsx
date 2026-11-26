import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router'
import { Platform, StyleSheet, View } from 'react-native'

import type { TPosture } from '../../layout/posture'
import { leadingHeaderOptionsOf } from '../../navigation/header-options'
import { photoDetailOf } from './photo-detail'
import type { Photo } from './photo-store'

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

const PhotoTitle = ({ photo }: { photo: Photo }) => {
  const detail = photoDetailOf(photo)
  return (
    <View style={styles.title} accessibilityRole="header">
      <Text
        size={ETextRole.Sm}
        weight={EFontWeight.Semibold}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {photo.name}
      </Text>
      {detail === undefined ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1}>
          {detail}
        </Text>
      )}
    </View>
  )
}

export const photoHeaderOptionsOf = ({
  photo,
  visible,
  posture,
  windowWidth,
  tint,
  onClose,
  onShare,
}: {
  photo: Photo | undefined
  visible: boolean
  posture: TPosture
  windowWidth: number
  tint: string
  onClose: () => void
  onShare: () => void
}): NativeStackNavigationOptions => {
  const base: NativeStackNavigationOptions = {
    headerShown: visible,
    headerTransparent: true,
    headerShadowVisible: false,
    headerTintColor: tint,
    scrollEdgeEffects: HIDDEN_EDGES,
  }
  if (Platform.OS !== 'ios')
    return {
      ...base,
      title: photo?.name ?? 'Photo',
      headerLeft: () => (
        <Button
          label="Close"
          variant={EButtonVariant.Ghost}
          size={EButtonSize.Sm}
          onPress={onClose}
        />
      ),
      headerRight: () =>
        photo === undefined ? null : (
          <Button
            label="Share"
            variant={EButtonVariant.Ghost}
            size={EButtonSize.Sm}
            onPress={onShare}
          />
        ),
    }
  const shareItems = photo === undefined ? [] : [shareItemOf(onShare)]
  if (photo === undefined)
    return {
      ...base,
      title: '',
      unstable_headerLeftItems: () => [closeItemOf(onClose)],
      unstable_headerRightItems: () => shareItems,
    }
  return {
    ...base,
    title: photo.name,
    ...leadingHeaderOptionsOf({
      leading: [closeItemOf(onClose)],
      title: <PhotoTitle photo={photo} />,
      glassTitle: true,
      titleButtons: 3,
      windowWidth,
      posture,
    }),
    unstable_headerRightItems: () => shareItems,
  }
}

const styles = StyleSheet.create({
  title: {
    flexShrink: 1,
  },
})
