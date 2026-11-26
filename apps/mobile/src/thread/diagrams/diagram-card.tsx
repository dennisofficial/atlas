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
  Spinner,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { Maximize2 } from 'lucide-react-native'
import { useCallback, useReducer, useState } from 'react'
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native'

import {
  cacheDiagramHeight,
  cachedDiagramHeight,
  clampDiagramHeight,
  diagramCardKey,
  DIAGRAM_ESTIMATE_HEIGHT,
  EDiagramCardEvent,
  fitDiagramHeight,
  type IDiagramSize,
  initialDiagramCardState,
  MERMAID_FONT,
  diagramCardReducer,
} from './diagram-layout'
import { putDiagramSource } from './diagram-store'
import MermaidView from './mermaid-view'

const FADE_HEIGHT = space(14)

interface IDiagramCardProps {
  source: string
  closed: boolean
}

export const DiagramCard = ({ source, closed }: IDiagramCardProps) => (
  <DiagramCardView key={diagramCardKey(source)} source={source} closed={closed} />
)

const DiagramCardView = ({ source, closed }: IDiagramCardProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [width, setWidth] = useState(0)
  const [state, dispatch] = useReducer(diagramCardReducer, initialDiagramCardState)

  const colors = {
    card: theme.card,
    border: theme.border,
    foreground: theme.foreground,
    mutedForeground: theme.mutedForeground,
    nodeFill: dark ? withAlpha({ color: theme.foreground, alpha: 0.08 }) : theme.card,
    nodeStroke: dark ? withAlpha({ color: theme.mutedForeground, alpha: 0.45 }) : theme.border,
  }

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width)
    setWidth((current) => (current === next ? current : next))
  }, [])

  const handleRendered = useCallback(
    async (size: IDiagramSize) => {
      dispatch({ type: EDiagramCardEvent.Rendered, size })
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
    dispatch({ type: EDiagramCardEvent.Failed, message })
  }, [])

  const handleOpen = useCallback(() => {
    router.push({ pathname: '/diagram', params: { id: putDiagramSource({ source }) } })
  }, [source])

  if (!closed || state.error !== undefined) {
    return (
      <View style={styles.fallback}>
        <CodeBlock block={{ language: 'mermaid', value: source }} />
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {state.error ?? 'Diagram appears when complete'}
        </Text>
      </View>
    )
  }

  const measured =
    state.size !== undefined && state.size.width > 0 && width > 0
      ? fitDiagramHeight({ size: state.size, targetWidth: width })
      : (cachedDiagramHeight({ source, width }) ?? DIAGRAM_ESTIMATE_HEIGHT)
  const { height, clamped } = clampDiagramHeight(measured)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the diagram"
      onPress={handleOpen}
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
        {width > 0 ? (
          <MermaidView
            source={source}
            colors={colors}
            font={MERMAID_FONT}
            interactive={false}
            onRendered={handleRendered}
            onError={handleError}
            dom={{ matchContents: false, scrollEnabled: false, style: { width, height } }}
          />
        ) : null}
        {state.size === undefined ? (
          <View pointerEvents="none" style={styles.loading}>
            <Spinner color={theme.mutedForeground} size={20} />
          </View>
        ) : null}
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
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
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
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
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
