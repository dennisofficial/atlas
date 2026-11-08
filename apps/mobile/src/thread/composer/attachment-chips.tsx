import { ETextRole, ETextTone, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Image } from 'expo-image'
import { FileText, X } from 'lucide-react-native'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import {
  describeBytes,
  EAttachmentStatus,
  isImageMediaType,
  type HeldAttachment,
} from './attachment-plan'

const CHIP = 72

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
          <FileText size={16} color={theme.mutedForeground} />
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
    paddingBottom: space(2),
    paddingHorizontal: space(1),
  },
  chip: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageChip: {
    height: CHIP,
    width: CHIP,
  },
  fileChip: {
    maxWidth: 200,
    minHeight: CHIP,
    padding: space(2),
    width: 176,
  },
  preview: {
    height: '100%',
    width: '100%',
  },
  fileRow: {
    flexDirection: 'row',
    gap: space(1.5),
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
    borderRadius: 999,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 3,
    top: 3,
    width: 20,
  },
})
