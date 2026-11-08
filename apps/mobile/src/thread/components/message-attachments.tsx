import type { Attachment } from '@dltech/atlas-core'
import { ETextRole, ETextTone, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Image } from 'expo-image'
import { FileText, X } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'

import { type AttachmentView, viewsOf } from '../attachment-views'
import { describeBytes } from '../composer/attachment-plan'
import { useAttachmentSources } from './use-attachment-sources'

const THUMB = 104

const FileChip = ({ view }: { view: AttachmentView }) => {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.file,
        {
          backgroundColor: withAlpha({ color: theme.foreground, alpha: 0.04 }),
          borderColor: withAlpha({ color: theme.foreground, alpha: 0.12 }),
        },
      ]}
    >
      <FileText size={16} color={theme.mutedForeground} />
      <View style={styles.fileText}>
        <Text size={ETextRole.Xs} numberOfLines={1} ellipsizeMode="middle">
          {view.name}
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {describeBytes(view.size)}
        </Text>
      </View>
    </View>
  )
}

export const MessageAttachments = ({
  threadId,
  attachments,
}: {
  threadId: string | undefined
  attachments: readonly Attachment[]
}) => {
  const sources = useAttachmentSources({ threadId, attachments })
  const views = viewsOf({ attachments, sources })
  const [opened, setOpened] = useState<AttachmentView | null>(null)

  if (views.length === 0) return null
  const images = views.filter((view) => view.image && view.uri !== undefined)
  const files = views.filter((view) => !view.image || view.uri === undefined)

  return (
    <View style={styles.stack}>
      {images.length === 0 ? null : (
        <View style={styles.grid}>
          {images.map((view) => (
            <Pressable
              key={view.key}
              accessibilityRole="button"
              accessibilityLabel={`Open ${view.name}`}
              onPress={() => setOpened(view)}
            >
              <Image
                source={{ uri: view.uri }}
                contentFit="cover"
                style={styles.thumb}
                accessibilityLabel={view.name}
              />
            </Pressable>
          ))}
        </View>
      )}
      {files.length === 0 ? null : (
        <View style={styles.files}>
          {files.map((view) => (
            <FileChip key={view.key} view={view} />
          ))}
        </View>
      )}
      <Modal
        visible={opened !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpened(null)}
      >
        <View style={styles.viewer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the photo"
            style={StyleSheet.absoluteFill}
            onPress={() => setOpened(null)}
          />
          {opened?.uri === undefined ? null : (
            <Image source={{ uri: opened.uri }} contentFit="contain" style={styles.full} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the photo"
            hitSlop={12}
            onPress={() => setOpened(null)}
            style={styles.close}
          >
            <X size={22} color="#ffffff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: space(2),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1.5),
  },
  thumb: {
    borderRadius: radius(1),
    height: THUMB,
    width: THUMB,
  },
  files: {
    gap: space(1.5),
  },
  file: {
    alignItems: 'center',
    borderRadius: radius(1),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(2),
    maxWidth: 280,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
  },
  fileText: {
    flexShrink: 1,
    gap: space(0.5),
  },
  viewer: {
    alignItems: 'center',
    backgroundColor: withAlpha({ color: '#000000', alpha: 0.92 }),
    flex: 1,
    justifyContent: 'center',
  },
  full: {
    height: '100%',
    width: '100%',
  },
  close: {
    position: 'absolute',
    right: space(4),
    top: space(12),
  },
})
