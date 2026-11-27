import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Host, Popover, RNHostView, Slider, Text, VStack } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  font,
  frame,
  ignoreSafeArea,
  padding,
} from '@expo/ui/swift-ui/modifiers'
import { radius } from '@dltech/atlas-ui/tokens'
import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { EffortGauge } from './effort-gauge'
import { effortAtIndex, effortIndexIn, effortSliderMaxOf } from './effort-slider-model'
import { effortChoicesOf, effortLabelOf, type IModelSelection } from './model-options'
import { COMPOSER_TRIGGER_INSET } from '../thread/composer/composer-shape'

const TRIGGER_HEIGHT = 28

export const EffortSelect = ({
  selection,
  onChange,
}: {
  selection: IModelSelection
  onChange: (effort: string) => void
}) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const efforts = effortChoicesOf(selection)
  const shown = pending ?? selection.effort
  const index = effortIndexIn({ efforts, effort: shown })

  const handleOpen = () => setOpen(true)

  const handlePresented = (presented: boolean) => {
    setOpen(presented)
    if (presented) return
    setPending(null)
  }

  const handleValue = (value: number) => {
    setPending(effortAtIndex({ efforts, index: value }))
  }

  const handleEditing = (isEditing: boolean) => {
    if (isEditing) return
    if (pending !== null && pending !== selection.effort) onChange(pending)
    setPending(null)
  }

  return (
    <Host colorScheme={dark ? 'dark' : 'light'} alignment="center" style={styles.host}>
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
              accessibilityLabel={`Effort: ${effortLabelOf(selection.effort)}`}
              onPress={handleOpen}
              style={({ pressed }) => [
                styles.trigger,
                pressed ? { backgroundColor: theme.muted } : null,
              ]}
            >
              <EffortGauge
                efforts={efforts}
                effort={selection.effort}
                color={theme.mutedForeground}
              />
            </Pressable>
          </RNHostView>
        </Popover.Trigger>
        <Popover.Content>
          <VStack
            alignment="leading"
            spacing={10}
            modifiers={[
              padding({ all: 16 }),
              frame({ width: 220 }),
              ignoreSafeArea({ regions: 'keyboard' }),
            ]}
          >
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' })]}>
              {effortLabelOf(shown)}
            </Text>
            <Slider
              value={index}
              min={0}
              max={effortSliderMaxOf(efforts)}
              step={1}
              onValueChange={handleValue}
              onEditingChanged={handleEditing}
              modifiers={[accessibilityLabel('Effort')]}
            />
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
    flexDirection: 'row',
    height: TRIGGER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: COMPOSER_TRIGGER_INSET,
  },
})
