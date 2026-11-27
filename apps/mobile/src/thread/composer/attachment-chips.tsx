import { ETextRole, ETextTone, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { Image } from 'expo-image'
import { FileText, FileVideoCamera, Play, X } from 'lucide-react-native'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { EAttachmentStatus } from '@dltech/atlas-client/session'

import {
  describeBytes,
  isImageMediaType,
  isVideoMediaType,
  type HeldAttachment,
} from './attachment-plan'
import {
  CHIP_RADIUS,
  CHIP_REMOVE_INSET,
  CHIP_REMOVE_SIZE,
  CHIP_SIZE,
  CHIP_THUMB_INSET,
  CHIP_THUMB_RADIUS,
  CHIP_THUMB_SIZE,
  COMPOSER_INSET,
} from './composer-shape'
import { useVideoThumbnail } from './video-thumbnail'

const VideoThumb = ({ uri }: { uri: string }) => (
  <View style={styles.thumb}>
    <Image source={{ uri }} contentFit="cover" style={styles.preview} />
    <View style={styles.play}>
      <Play size={10} color="#ffffff" fill="#ffffff" />
    </View>
  </View>
)

const FileGlyph = ({ mediaType, color }: { mediaType: string; color: string }) =>
  isVideoMediaType(mediaType) ? (
    <FileVideoCamera size={16} color={color} />
  ) : (
    <FileText size={16} color={color} />
  )

const Chip = ({ entry, onRemove }: { entry: HeldAttachment; onRemove: (id: string) => void }) => {
  const theme = useTheme()
  const image = isImageMediaType(entry.mediaType)
  const thumbnail = useVideoThumbnail({ uri: entry.uri, mediaType: entry.mediaType })
  const uploading = entry.status === EAttachmentStatus.Uploading
  const failed = entry.status === EAttachmentStatus.Failed
  const border = failed ? theme.destructive : withAlpha({ color: theme.foreground, alpha: 0.12 })
  const subtitle = failed
    ? 'Upload failed'
    : uploading
      ? `Uploading ${Math.round(entry.progress * 100)}%`
      : describeBytes(entry.size)

  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: theme.card, borderColor: border },
        image ? styles.imageChip : styles.fileChip,
        thumbnail === null ? null : styles.videoChip,
      ]}
    >
      {image ? (
        <Image source={{ uri: entry.uri }} contentFit="cover" style={styles.preview} />
      ) : (
        <View style={styles.fileRow}>
          {thumbnail === null ? (
            <FileGlyph mediaType={entry.mediaType} color={theme.mutedForeground} />
          ) : (
            <VideoThumb uri={thumbnail} />
          )}
          <View style={styles.fileText}>
            <Text size={ETextRole.Xs} numberOfLines={2} ellipsizeMode="middle">
              {entry.name}
            </Text>
            <Text size={ETextRole.Xs} tone={failed ? ETextTone.Destructive : ETextTone.Muted}>
              {subtitle}
            </Text>
          </View>
        </View>
      )}
      {image ? (
        <View style={styles.caption}>
          <Text size={ETextRole.Xs} tone={failed ? ETextTone.Destructive : ETextTone.Muted}>
            {failed ? 'Failed' : uploading ? `${Math.round(entry.progress * 100)}%` : ''}
          </Text>
        </View>
      ) : null}
      {uploading ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { backgroundColor: theme.primary, width: `${Math.round(entry.progress * 100)}%` },
            ]}
          />
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${entry.name}`}
        hitSlop={8}
        onPress={() => onRemove(entry.id)}
        style={[styles.remove, { backgroundColor: theme.background }]}
      >
        <X size={12} color={theme.foreground} />
      </Pressable>
    </View>
  )
}

export const AttachmentChips = ({
  held,
  onRemove,
}: {
  held: readonly HeldAttachment[]
  onRemove: (id: string) => void
}) => {
  if (held.length === 0) return null
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {held.map((entry) => (
        <Chip key={entry.id} entry={entry} onRemove={onRemove} />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: {
    gap: space(2),
    paddingHorizontal: COMPOSER_INSET,
    paddingTop: COMPOSER_INSET,
  },
  chip: {
    borderRadius: CHIP_RADIUS,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageChip: {
    height: CHIP_SIZE,
    width: CHIP_SIZE,
  },
  fileChip: {
    height: CHIP_SIZE,
    justifyContent: 'center',
    paddingLeft: CHIP_THUMB_INSET,
    paddingRight: CHIP_REMOVE_SIZE + 2 * CHIP_REMOVE_INSET,
    width: 176,
  },
  videoChip: {
    width: 216,
  },
  thumb: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: CHIP_THUMB_RADIUS,
    height: CHIP_THUMB_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: CHIP_THUMB_SIZE,
  },
  play: {
    alignItems: 'center',
    backgroundColor: withAlpha({ color: '#000000', alpha: 0.45 }),
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    paddingLeft: 1,
    position: 'absolute',
    width: 20,
  },
  preview: {
    height: '100%',
    width: '100%',
  },
  fileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  fileText: {
    flex: 1,
    gap: space(0.5),
  },
  caption: {
    bottom: 2,
    left: space(1),
    position: 'absolute',
  },
  track: {
    backgroundColor: withAlpha({ color: '#000000', alpha: 0.2 }),
    bottom: 0,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  fill: {
    height: 3,
  },
  remove: {
    alignItems: 'center',
    borderRadius: CHIP_REMOVE_SIZE / 2,
    height: CHIP_REMOVE_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    right: CHIP_REMOVE_INSET,
    top: CHIP_REMOVE_INSET,
    width: CHIP_REMOVE_SIZE,
  },
})
