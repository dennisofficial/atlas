import { ETextRole, ETextTone, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { Image } from 'expo-image'
import { FileText, FileVideoCamera, X } from 'lucide-react-native'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { EAttachmentStatus } from '@dltech/atlas-client/session'

import { describeBytes, isImageMediaType, type HeldAttachment } from './attachment-plan'
import { CHIP_RADIUS, CHIP_REMOVE_INSET, CHIP_REMOVE_SIZE, COMPOSER_INSET } from './composer-shape'

const CHIP = 72

const isVideoMediaType = (mediaType: string): boolean => mediaType.startsWith('video/')

const Chip = ({ entry, onRemove }: { entry: HeldAttachment; onRemove: (id: string) => void }) => {
  const theme = useTheme()
  const image = isImageMediaType(entry.mediaType)
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
      ]}
    >
      {image ? (
        <Image source={{ uri: entry.uri }} contentFit="cover" style={styles.preview} />
      ) : (
        <View style={styles.fileRow}>
          {isVideoMediaType(entry.mediaType) ? (
            <FileVideoCamera size={16} color={theme.mutedForeground} />
          ) : (
            <FileText size={16} color={theme.mutedForeground} />
          )}
          <View style={styles.fileText}>
            <Text size={ETextRole.Xs} numberOfLines={1} ellipsizeMode="middle">
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
    height: CHIP,
    width: CHIP,
  },
  fileChip: {
    height: CHIP,
    justifyContent: 'center',
    paddingLeft: space(2.5),
    paddingRight: CHIP_REMOVE_SIZE + 2 * CHIP_REMOVE_INSET,
    width: 176,
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
