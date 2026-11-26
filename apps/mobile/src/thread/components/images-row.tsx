import { radius, space } from '@dltech/atlas-ui/tokens'
import { useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { ImagesRow } from '../rows'
import { pictureBoxOf } from '../tool-pictures'
import { PhotoViewer } from './photo-viewer'
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
  const [opened, setOpened] = useState<string | undefined>(undefined)

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
            onPress={() => setOpened(uri)}
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
      <PhotoViewer uri={opened} onClose={() => setOpened(undefined)} />
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
