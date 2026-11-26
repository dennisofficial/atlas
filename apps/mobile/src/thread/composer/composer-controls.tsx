import { space } from '@dltech/atlas-ui/tokens'
import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { ArrowUp, Square } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { AttachButton } from './attach-button'
import type { EAttachSource } from './attach-sources'

export const ComposerControls = ({
  attach,
  sending,
  canSend,
  onStop,
  onSend,
  trailing,
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
    {onStop !== undefined ? (
      <Button
        label="Stop"
        icon={Square}
        size={EButtonSize.IconSm}
        variant={EButtonVariant.Secondary}
        round
        onPress={onStop}
      />
    ) : (
      <Button
        label={sending ? 'Sending…' : 'Send'}
        icon={ArrowUp}
        size={EButtonSize.IconSm}
        round
        disabled={!canSend}
        loading={sending}
        onPress={onSend}
      />
    )}
  </View>
)

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    justifyContent: 'space-between',
    paddingBottom: space(2),
    paddingTop: space(1.5),
  },
  slot: {
    flex: 1,
    minWidth: 0,
  },
  slotContent: {
    alignItems: 'center',
    gap: space(1),
  },
})
