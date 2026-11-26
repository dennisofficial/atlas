import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, useLocalSearchParams } from 'expo-router'
import { Share2, X } from 'lucide-react-native'
import { useCallback } from 'react'
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { contentInsetsOf, postureOf } from '../../layout/posture'
import { PhotoActionButton } from '../../thread/photos/photo-action-button'
import { photoOf } from '../../thread/photos/photo-store'
import { PhotoTitle } from '../../thread/photos/photo-title'
import { sharePhoto } from '../../thread/photos/share-photo'
import { ZoomablePhoto } from '../../thread/photos/zoomable-photo'

const PhotoViewer = () => {
  const theme = useTheme()
  const { width, height } = useWindowDimensions()
  const windowInsets = useSafeAreaInsets()
  const posture = postureOf({ width, height, insets: windowInsets })
  const insets = contentInsetsOf({ insets: windowInsets, posture })
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
    <View
      style={[styles.root, { paddingRight: posture.railWidth, backgroundColor: theme.sidebar }]}
    >
      <View style={[styles.content, { backgroundColor: theme.background }]}>
        {photo === undefined ? (
          <View style={styles.center}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              This photo is no longer available.
            </Text>
          </View>
        ) : (
          <ZoomablePhoto uri={photo.uri} name={photo.name} onDismiss={handleClose} />
        )}
        <View
          pointerEvents="box-none"
          style={[
            styles.actions,
            {
              top: insets.top + space(2),
              left: insets.left + space(4),
              right: insets.right + space(4),
            },
          ]}
        >
          <PhotoActionButton
            symbol="xmark"
            fallback={<X size={20} color={theme.foreground} />}
            label="Close the photo"
            onPress={handleClose}
          />
          {photo === undefined ? null : <PhotoTitle name={photo.name} />}
          {photo === undefined ? null : (
            <PhotoActionButton
              symbol="square.and.arrow.up"
              fallback={<Share2 size={20} color={theme.foreground} />}
              label="Share the photo"
              onPress={handleShare}
            />
          )}
        </View>
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'absolute',
  },
})
