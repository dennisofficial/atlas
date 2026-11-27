import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { AttachButton } from './attach-button'
import type { EAttachSource } from './attach-sources'
import { SendButton } from './send-button'
import {
  CONTROLS_GAP,
  CONTROLS_PADDING_BOTTOM,
  CONTROLS_PADDING_TOP,
  ESendAction,
} from './send-press'

export const ComposerControls = ({
  attach,
  sending,
  canSend,
  onStop,
  onSend,
  trailing,
  trailingPressable,
  children,
}: {
  attach:
    | { open: boolean; onPick: (source: EAttachSource) => void; onToggle: () => void }
    | undefined
  sending: boolean
  canSend: boolean
  onStop: (() => void) | undefined
  onSend: () => void
  trailing?: ReactNode
  trailingPressable: boolean
  children?: ReactNode
}) => (
  <View style={styles.bar}>
    {attach === undefined ? null : (
      <AttachButton open={attach.open} onPick={attach.onPick} onToggle={attach.onToggle} />
    )}
    {children === undefined ? null : (
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.slot}
        contentContainerStyle={styles.slotContent}
      >
        {children}
      </ScrollView>
    )}
    {trailing}
    <SendButton
      action={onStop === undefined ? ESendAction.Send : ESendAction.Stop}
      disabled={onStop === undefined && !canSend}
      loading={onStop === undefined && sending}
      besidePressable={trailingPressable}
      onPress={onStop ?? onSend}
    />
  </View>
)

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: CONTROLS_GAP,
    justifyContent: 'space-between',
    paddingBottom: CONTROLS_PADDING_BOTTOM,
    paddingTop: CONTROLS_PADDING_TOP,
  },
  slot: {
    flex: 1,
    minWidth: 0,
  },
  slotContent: {
    alignItems: 'center',
  },
})
