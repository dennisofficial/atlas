import {
  Button,
  CodeBlock,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
  useIsDark,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import * as Clipboard from 'expo-clipboard'
import { type NativeStackHeaderItem, router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Platform, ScrollView, Share, StyleSheet, View } from 'react-native'

import { MERMAID_FONT } from '../../thread/diagrams/diagram-layout'
import { diagramSourceOf } from '../../thread/diagrams/diagram-store'
import MermaidView from '../../thread/diagrams/mermaid-view'

enum EDiagramMode {
  Diagram = 'diagram',
  Source = 'source',
}

const diagramHeaderItems = ({
  mode,
  onToggle,
  onCopy,
  onShare,
}: {
  mode: EDiagramMode
  onToggle: () => void
  onCopy: () => void
  onShare: () => void
}): NativeStackHeaderItem[] => [
  {
    type: 'button',
    label: mode === EDiagramMode.Diagram ? 'Source' : 'Diagram',
    accessibilityLabel: mode === EDiagramMode.Diagram ? 'Show the source' : 'Show the diagram',
    onPress: onToggle,
    hidesSharedBackground: false,
  },
  {
    type: 'button',
    label: 'Copy',
    icon: { type: 'sfSymbol', name: 'doc.on.doc' },
    accessibilityLabel: 'Copy the diagram source',
    onPress: onCopy,
    hidesSharedBackground: false,
  },
  {
    type: 'button',
    label: 'Share',
    icon: { type: 'sfSymbol', name: 'square.and.arrow.up' },
    accessibilityLabel: 'Share the diagram source',
    onPress: onShare,
    hidesSharedBackground: false,
  },
]

export default function DiagramScreen() {
  const theme = useTheme()
  const dark = useIsDark()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const source = diagramSourceOf(id)
  const [mode, setMode] = useState(EDiagramMode.Diagram)

  const handleClose = useCallback(() => router.back(), [])
  const handleToggle = useCallback(
    () =>
      setMode((current) =>
        current === EDiagramMode.Diagram ? EDiagramMode.Source : EDiagramMode.Diagram,
      ),
    [],
  )
  const handleCopy = useCallback(async () => {
    if (source !== undefined) await Clipboard.setStringAsync(source)
  }, [source])
  const handleShare = useCallback(async () => {
    if (source === undefined) return
    await Share.share({ message: source, title: 'Diagram source' })
  }, [source])

  const items = diagramHeaderItems({
    mode,
    onToggle: handleToggle,
    onCopy: handleCopy,
    onShare: handleShare,
  })

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: 'Diagram',
          ...(Platform.OS === 'ios'
            ? {
                unstable_headerLeftItems: (): NativeStackHeaderItem[] => [
                  {
                    type: 'button',
                    label: 'Close',
                    icon: { type: 'sfSymbol', name: 'xmark' },
                    accessibilityLabel: 'Close',
                    onPress: handleClose,
                    hidesSharedBackground: false,
                  },
                ],
                unstable_headerRightItems: () => items,
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
                headerRight: () => (
                  <View style={styles.headerButtons}>
                    <Button
                      label={mode === EDiagramMode.Diagram ? 'Source' : 'Diagram'}
                      variant={EButtonVariant.Ghost}
                      size={EButtonSize.Sm}
                      onPress={handleToggle}
                    />
                    <Button
                      label="Copy"
                      variant={EButtonVariant.Ghost}
                      size={EButtonSize.Sm}
                      onPress={handleCopy}
                    />
                    <Button
                      label="Share"
                      variant={EButtonVariant.Ghost}
                      size={EButtonSize.Sm}
                      onPress={handleShare}
                    />
                  </View>
                ),
              }),
        }}
      />
      {source === undefined ? (
        <View style={styles.center}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            This diagram is no longer available.
          </Text>
        </View>
      ) : mode === EDiagramMode.Diagram ? (
        <MermaidView
          source={source}
          colors={{
            card: theme.card,
            border: theme.border,
            foreground: theme.foreground,
            mutedForeground: theme.mutedForeground,
            nodeFill: dark ? withAlpha({ color: theme.foreground, alpha: 0.08 }) : theme.card,
            nodeStroke: dark
              ? withAlpha({ color: theme.mutedForeground, alpha: 0.45 })
              : theme.border,
          }}
          font={MERMAID_FONT}
          interactive
          dom={{ matchContents: false, scrollEnabled: false, style: { flex: 1 } }}
        />
      ) : (
        <ScrollView
          scrollsToTop={false}
          contentContainerStyle={styles.source}
          style={styles.scroll}
        >
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.sourceLabel}>
            Mermaid source
          </Text>
          <CodeBlock block={{ language: 'mermaid', value: source }} />
        </ScrollView>
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
  headerButtons: {
    flexDirection: 'row',
    gap: space(1),
  },
  scroll: {
    flex: 1,
  },
  source: {
    gap: space(2),
    padding: space(4),
  },
  sourceLabel: {
    textTransform: 'uppercase',
  },
})
