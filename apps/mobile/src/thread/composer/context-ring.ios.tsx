import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { radius } from '@dltech/atlas-ui/tokens'
import {
  Divider,
  HStack,
  Host,
  Popover,
  ProgressView,
  RNHostView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  ignoreSafeArea,
  monospacedDigit,
  padding,
  progressViewStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { COMPOSER_TRIGGER_INSET } from './composer-shape'
import {
  type ContextRingProps,
  contextLabelOf,
  type PopoverMeter,
  type PopoverSection,
  popoverSectionsOf,
  shownUsageOf,
} from './context-reading'
import { ContextRingGlyph, toneColorOf } from './context-ring-glyph'

const TRIGGER_HEIGHT = 28
const POPOVER_CONTENT_WIDTH = 228
const POPOVER_PADDING = 16
const SECTION_SPACING = 14
const METER_SPACING = 12
const METER_PART_SPACING = 6

type Theme = ReturnType<typeof useTheme>

const MeterRow = ({ meter, theme }: { meter: PopoverMeter; theme: Theme }) => {
  const toneColor = toneColorOf({ tone: meter.tone, theme })
  return (
    <VStack alignment="leading" spacing={METER_PART_SPACING}>
      <HStack alignment="firstTextBaseline" spacing={8}>
        <Text
          modifiers={[
            font({ textStyle: 'subheadline', weight: 'medium' }),
            foregroundStyle(theme.foreground),
          ]}
        >
          {meter.label}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ textStyle: 'subheadline', weight: 'semibold' }),
            monospacedDigit(),
            foregroundStyle(toneColor),
          ]}
        >
          {meter.value}
        </Text>
      </HStack>
      <ProgressView
        value={meter.fraction}
        modifiers={[
          progressViewStyle('linear'),
          tint(toneColor),
          accessibilityLabel(`${meter.label} ${meter.value}`),
        ]}
      />
      {meter.detail === null ? null : (
        <Text
          modifiers={[
            font({ textStyle: 'caption' }),
            monospacedDigit(),
            foregroundStyle(theme.mutedForeground),
          ]}
        >
          {meter.detail}
        </Text>
      )}
    </VStack>
  )
}

const SectionBlock = ({ section, theme }: { section: PopoverSection; theme: Theme }) => (
  <VStack alignment="leading" spacing={METER_SPACING}>
    {section.title === null ? null : (
      <Text
        modifiers={[
          font({ textStyle: 'footnote', weight: 'semibold' }),
          foregroundStyle(theme.mutedForeground),
        ]}
      >
        {section.title}
      </Text>
    )}
    {section.meters.map((meter) => (
      <MeterRow key={meter.key} meter={meter} theme={theme} />
    ))}
  </VStack>
)

export const ContextRing = ({ context, usage }: ContextRingProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [open, setOpen] = useState(false)
  const sections = popoverSectionsOf({ context, usage: shownUsageOf(usage), now: Date.now() })

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
            spacing={SECTION_SPACING}
            modifiers={[
              frame({ width: POPOVER_CONTENT_WIDTH, alignment: 'leading' }),
              padding({ all: POPOVER_PADDING }),
              ignoreSafeArea({ regions: 'keyboard' }),
            ]}
          >
            {sections.map((section, index) => (
              <VStack key={section.key} alignment="leading" spacing={SECTION_SPACING}>
                {index === 0 ? null : <Divider />}
                <SectionBlock section={section} theme={theme} />
              </VStack>
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
