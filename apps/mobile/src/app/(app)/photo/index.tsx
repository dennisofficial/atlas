import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { postureOf } from '../../../layout/posture'
import { photoHeaderOptionsOf } from '../../../thread/photos/photo-header-options'
import { chromeVisibleAfter, EPhotoChromeEvent } from '../../../thread/photos/photo-zoom'
import { photoOf } from '../../../thread/photos/photo-store'
import { sharePhoto } from '../../../thread/photos/share-photo'
import { ZoomablePhoto } from '../../../thread/photos/zoomable-photo'

const PhotoViewer = () => {
  const theme = useTheme()
  const { width, height } = useWindowDimensions()
  const windowInsets = useSafeAreaInsets()
  const posture = postureOf({ width, height, insets: windowInsets })
  const { id } = useLocalSearchParams<{ id?: string }>()
  const photo = photoOf(id)

  const handleClose = useCallback(() => router.back(), [])
  const [chromeVisible, setChromeVisible] = useState(true)
  const handleChrome = useCallback(
    (event: EPhotoChromeEvent) =>
      setChromeVisible((visible) => chromeVisibleAfter({ visible, event })),
    [],
  )
  const handleTap = useCallback(() => handleChrome(EPhotoChromeEvent.Tap), [handleChrome])
  const handleZoomIn = useCallback(() => handleChrome(EPhotoChromeEvent.ZoomedIn), [handleChrome])
  const handleShare = useCallback(async () => {
    if (photo === undefined) return
    try {
      await sharePhoto(photo)
    } catch (error) {
      Alert.alert('Could not share the photo', error instanceof Error ? error.message : undefined)
    }
  }, [photo])

  return (
    <View
      style={[styles.root, { paddingRight: posture.railWidth, backgroundColor: theme.sidebar }]}
    >
      <Stack.Screen
        options={photoHeaderOptionsOf({
          photo,
          visible: chromeVisible,
          posture,
          windowWidth: width,
          tint: theme.foreground,
          onClose: handleClose,
          onShare: handleShare,
        })}
      />
      <View style={[styles.content, { backgroundColor: theme.background }]}>
        {photo === undefined ? (
          <View style={styles.center}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              This photo is no longer available.
            </Text>
          </View>
        ) : (
          <ZoomablePhoto
            uri={photo.uri}
            name={photo.name}
            onDismiss={handleClose}
            onTap={handleTap}
            onZoomIn={handleZoomIn}
          />
        )}
      </View>
    </View>
  )
}

export default function PhotoScreen() {
  return (
    <SafeAreaProvider>
      <PhotoViewer />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: space(6),
  },
})
