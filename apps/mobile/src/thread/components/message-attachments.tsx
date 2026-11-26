import type { Attachment } from '@dltech/atlas-core'
import { ETextRole, ETextTone, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Image } from 'expo-image'
import { FileText } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { type AttachmentView, viewsOf } from '../attachment-views'
import { describeBytes } from '../composer/attachment-plan'
import { openPhoto } from '../photos/open-photo'
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
  sessionId,
  attachments,
}: {
  threadId: string | undefined
  sessionId: string | undefined
  attachments: readonly Attachment[]
}) => {
  const sources = useAttachmentSources({ threadId, sessionId, attachments })
  const views = viewsOf({ attachments, sources })

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
              onPress={() => {
                if (view.uri !== undefined) openPhoto({ uri: view.uri, name: view.name })
              }}
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
})
