import { useState, type ReactNode } from 'react'
import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { COLLAPSED_BODY_HEIGHT, inboundClampOf } from './inbound-clamp'

const FADE_HEIGHT = 64
const FADE_ID = 'collapsible-body-fade'

const Fade = () => {
  const theme = useTheme()
  return (
    <Svg pointerEvents="none" style={styles.fade} width="100%" height={FADE_HEIGHT}>
      <Defs>
        <LinearGradient id={FADE_ID} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.background} stopOpacity={0} />
          <Stop offset="1" stopColor={theme.background} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${FADE_ID})`} />
    </Svg>
  )
}

export const CollapsibleBody = ({ children }: { children: ReactNode }) => {
  const [contentHeight, setContentHeight] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const { overflows, clamped } = inboundClampOf({ contentHeight, expanded })

  const handleLayout = (event: LayoutChangeEvent) =>
    setContentHeight(event.nativeEvent.layout.height)
  const handleToggle = () => setExpanded((previous) => !previous)

  return (
    <View style={styles.root}>
      <View style={clamped ? styles.clamped : undefined}>
        <View onLayout={handleLayout}>{children}</View>
        {clamped ? <Fade /> : null}
      </View>
      {overflows ? (
        <View style={styles.toggle}>
          <Button
            label={expanded ? 'Show less' : 'Show more'}
            icon={expanded ? ChevronUp : ChevronDown}
            variant={EButtonVariant.Ghost}
            size={EButtonSize.Sm}
            onPress={handleToggle}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    gap: space(1),
  },
  clamped: {
    maxHeight: COLLAPSED_BODY_HEIGHT,
    overflow: 'hidden',
  },
  fade: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  toggle: {
    alignItems: 'flex-start',
  },
})
