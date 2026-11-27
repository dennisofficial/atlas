import { useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { type ReactNode, type RefObject, useEffect, useState } from 'react'
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewInstance,
} from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { dropdownPlacementOf, type TRect } from './dropdown-placement'
import { useKeyboard } from './use-keyboard'

const KEYBOARD_HIDE_TIMEOUT_MS = 600

const measureSettledAnchor = ({
  target,
  onMeasured,
}: {
  target: RefObject<ViewInstance | null>
  onMeasured: (rect: TRect) => void
}): (() => void) => {
  let cancelled = false
  let settled = false
  let frame: number | null = null
  const keyboardUp = Keyboard.isVisible()

  const handleSettled = () => {
    if (settled) return
    settled = true
    subscription?.remove()
    clearTimeout(timer)
    frame = requestAnimationFrame(() => {
      target.current?.measureInWindow((x, y, width, height) => {
        if (!cancelled) onMeasured({ x, y, width, height })
      })
    })
  }

  const subscription = keyboardUp ? Keyboard.addListener('keyboardDidHide', handleSettled) : null
  const timer = setTimeout(handleSettled, keyboardUp ? KEYBOARD_HIDE_TIMEOUT_MS : 0)
  if (keyboardUp) Keyboard.dismiss()

  return () => {
    cancelled = true
    subscription?.remove()
    clearTimeout(timer)
    if (frame !== null) cancelAnimationFrame(frame)
  }
}

const DropdownPanel = ({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: TRect
  label: string
  onClose: () => void
  children: ReactNode
}) => {
  const theme = useTheme()
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboard()
  const placement = dropdownPlacementOf({
    anchor,
    window,
    insets,
    keyboardInset: keyboard.inset,
  })

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close the ${label}`}
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.panel,
          placement.edge,
          {
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
            backgroundColor: theme.popover,
            borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
          },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

export const AnchoredDropdown = ({
  open,
  anchorRef,
  label,
  onClose,
  children,
}: {
  open: boolean
  anchorRef: RefObject<ViewInstance | null>
  label: string
  onClose: () => void
  children: ReactNode
}) => {
  const [anchor, setAnchor] = useState<TRect | null>(null)

  useEffect(() => {
    if (!open) return
    const cancel = measureSettledAnchor({ target: anchorRef, onMeasured: setAnchor })
    return () => {
      cancel()
      setAnchor(null)
    }
  }, [open, anchorRef])

  return (
    <Modal
      transparent
      animationType="fade"
      visible={open && anchor !== null}
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        {anchor === null ? null : (
          <DropdownPanel anchor={anchor} label={label} onClose={onClose}>
            {children}
          </DropdownPanel>
        )}
      </SafeAreaProvider>
    </Modal>
  )
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    elevation: 8,
    padding: space(1),
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
})
