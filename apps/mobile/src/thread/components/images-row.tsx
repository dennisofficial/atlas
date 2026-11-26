import { radius, space } from '@dltech/atlas-ui/tokens'
import { useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { Image } from 'expo-image'
import { Pressable, StyleSheet, View } from 'react-native'

import type { ImagesRow } from '../rows'
import { pictureBoxOf } from '../tool-pictures'
import { openPhoto } from '../photos/open-photo'
import { useMediaUrls } from './use-media-urls'

export const ImagesRowView = ({
  row,
  sessionId,
}: {
  row: ImagesRow
  sessionId: string | undefined
}) => {
  const theme = useTheme()
  const urls = useMediaUrls({ sessionId, hashes: row.images.map((image) => image.hash) })

  return (
    <View style={styles.stack}>
      {row.images.map((image) => {
        const uri = urls.get(image.hash)
        const box = pictureBoxOf(image)
        return (
          <Pressable
            key={image.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${image.alt}`}
            disabled={uri === undefined}
            onPress={() => {
              if (uri === undefined) return
              openPhoto({
                uri,
                name: image.alt,
                mediaType: image.mediaType,
                size: image.size,
                width: image.width,
                height: image.height,
              })
            }}
            style={[
              styles.frame,
              box,
              { backgroundColor: withAlpha({ color: theme.foreground, alpha: 0.04 }) },
            ]}
          >
            {uri === undefined ? null : (
              <Image
                source={{ uri }}
                contentFit="cover"
                style={styles.picture}
                accessibilityLabel={image.alt}
              />
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: {
    alignItems: 'flex-start',
    gap: space(2),
  },
  frame: {
    borderRadius: radius(1),
    maxWidth: '100%',
    overflow: 'hidden',
  },
  picture: {
    height: '100%',
    width: '100%',
  },
})
