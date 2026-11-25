import {
  CodeBlock,
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Text,
  useIsDark,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { Maximize2 } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native'

import {
  cacheDiagramHeight,
  cachedDiagramHeight,
  clampDiagramHeight,
  DIAGRAM_ESTIMATE_HEIGHT,
  fitDiagramHeight,
  type IDiagramSize,
  MERMAID_FONT,
} from './diagram-layout'
import { putDiagramSource } from './diagram-store'
import MermaidView from './mermaid-view'

const FADE_HEIGHT = space(14)

export const DiagramCard = ({ source, closed }: { source: string; closed: boolean }) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [width, setWidth] = useState(0)
  const [rendered, setRendered] = useState<IDiagramSize>()
  const [error, setError] = useState<string>()

  const colors = {
    card: theme.card,
    border: theme.border,
    foreground: theme.foreground,
    mutedForeground: theme.mutedForeground,
  }

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width)
    setWidth((current) => (current === next ? current : next))
  }, [])

  const handleRendered = useCallback(
    async (size: IDiagramSize) => {
      setRendered(size)
      if (width <= 0) return
      cacheDiagramHeight({
        source,
        width,
        height: fitDiagramHeight({ size, targetWidth: width }),
      })
    },
    [source, width],
  )

  const handleError = useCallback(async (message: string) => {
    setError(message)
  }, [])

  const handleOpen = useCallback(() => {
    router.push({ pathname: '/diagram', params: { id: putDiagramSource({ source }) } })
  }, [source])

  if (!closed || error !== undefined) {
    return (
      <View style={styles.fallback}>
        <CodeBlock block={{ language: 'mermaid', value: source }} />
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {error ?? 'Diagram appears when complete'}
        </Text>
      </View>
    )
  }

  const measured =
    rendered !== undefined && rendered.width > 0 && width > 0
      ? fitDiagramHeight({ size: rendered, targetWidth: width })
      : (cachedDiagramHeight({ source, width }) ?? DIAGRAM_ESTIMATE_HEIGHT)
  const { height, clamped } = clampDiagramHeight(measured)

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: theme.input,
          backgroundColor: dark ? withAlpha({ color: theme.input, alpha: 0.3 }) : 'transparent',
        },
      ]}
    >
      <View style={styles.header}>
        <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
          Diagram
        </Text>
        <Icon icon={Maximize2} color={theme.mutedForeground} size={14} />
      </View>
      <View style={[styles.body, { height }]} onLayout={handleLayout}>
        <MermaidView
          source={source}
          colors={colors}
          font={MERMAID_FONT}
          interactive={false}
          onRendered={handleRendered}
          onError={handleError}
          dom={{ matchContents: true, scrollEnabled: false }}
        />
        {clamped ? (
          <View
            pointerEvents="none"
            style={[
              styles.fade,
              { backgroundColor: withAlpha({ color: theme.background, alpha: 0.92 }) },
            ]}
          >
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              Tap to view full diagram
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the diagram"
          onPress={handleOpen}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius(2),
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  body: {
    overflow: 'hidden',
    width: '100%',
  },
  fade: {
    alignItems: 'center',
    bottom: 0,
    height: FADE_HEIGHT,
    justifyContent: 'flex-end',
    left: 0,
    paddingBottom: space(2),
    position: 'absolute',
    right: 0,
  },
  fallback: {
    gap: space(2),
  },
})
