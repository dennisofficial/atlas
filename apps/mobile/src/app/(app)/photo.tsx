import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { type NativeStackHeaderItem, router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { Alert, Platform, StyleSheet, View } from 'react-native'

import { photoOf } from '../../thread/photos/photo-store'
import { sharePhoto } from '../../thread/photos/share-photo'
import { ZoomablePhoto } from '../../thread/photos/zoomable-photo'

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

export default function PhotoScreen() {
  const theme = useTheme()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const photo = photoOf(id)

  const handleClose = useCallback(() => router.back(), [])
  const handleShare = useCallback(async () => {
    if (photo === undefined) return
    try {
      await sharePhoto(photo)
    } catch (error) {
      Alert.alert('Could not share the photo', error instanceof Error ? error.message : undefined)
    }
  }, [photo])

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: photo?.name ?? 'Photo',
          ...(Platform.OS === 'ios'
            ? {
                unstable_headerLeftItems: () => [closeItemOf(handleClose)],
                unstable_headerRightItems: () =>
                  photo === undefined ? [] : [shareItemOf(handleShare)],
              }
            : {
                headerLeft: () => (
                  <Button
                    label="Close"
                    variant={EButtonVariant.Ghost}
                    size={EButtonSize.Sm}
                    onPress={handleClose}
                  />
                ),
              }),
        }}
      />
      {photo === undefined ? (
        <View style={styles.center}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            This photo is no longer available.
          </Text>
        </View>
      ) : (
        <ZoomablePhoto uri={photo.uri} name={photo.name} onDismiss={handleClose} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: space(6),
  },
})
