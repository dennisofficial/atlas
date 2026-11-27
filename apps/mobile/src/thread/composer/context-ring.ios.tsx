import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { radius } from '@dltech/atlas-ui/tokens'
import { Host, Popover, RNHostView, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, frame, ignoreSafeArea, padding } from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { COMPOSER_TRIGGER_INSET } from './composer-shape'
import {
  type ContextRingProps,
  contextLabelOf,
  popoverLinesOf,
  shownUsageOf,
} from './context-reading'
import { ContextRingGlyph, toneColorOf } from './context-ring-glyph'

const TRIGGER_HEIGHT = 28
const POPOVER_WIDTH = 200
const POPOVER_PADDING = 16
const POPOVER_SPACING = 8

export const ContextRing = ({ context, usage }: ContextRingProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [open, setOpen] = useState(false)
  const lines = popoverLinesOf({ context, usage: shownUsageOf(usage) })

  const handleOpen = () => setOpen(true)

  const handlePresented = (presented: boolean) => setOpen(presented)

  return (
    <Host
      colorScheme={dark ? 'dark' : 'light'}
      alignment="center"
      ignoreSafeArea="keyboard"
      style={styles.host}
    >
      <Popover
        isPresented={open}
        onIsPresentedChange={handlePresented}
        attachmentAnchor="top"
        arrowEdge="bottom"
      >
        <Popover.Trigger>
          <RNHostView matchContents>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={contextLabelOf(context)}
              onPress={handleOpen}
              style={({ pressed }) => [
                styles.trigger,
                pressed ? { backgroundColor: theme.muted } : null,
              ]}
            >
              <ContextRingGlyph context={context} />
            </Pressable>
          </RNHostView>
        </Popover.Trigger>
        <Popover.Content>
          <VStack
            alignment="leading"
            spacing={POPOVER_SPACING}
            modifiers={[
              padding({ all: POPOVER_PADDING }),
              frame({ width: POPOVER_WIDTH }),
              ignoreSafeArea({ regions: 'keyboard' }),
            ]}
          >
            {lines.map((line) => (
              <Text
                key={line.key}
                modifiers={[
                  font({ textStyle: 'subheadline', weight: 'medium' }),
                  foregroundStyle(toneColorOf({ tone: line.tone, theme })),
                ]}
              >
                {line.text}
              </Text>
            ))}
          </VStack>
        </Popover.Content>
      </Popover>
    </Host>
  )
}

const styles = StyleSheet.create({
  host: {
    height: TRIGGER_HEIGHT,
  },
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    height: TRIGGER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: COMPOSER_TRIGGER_INSET,
  },
})
