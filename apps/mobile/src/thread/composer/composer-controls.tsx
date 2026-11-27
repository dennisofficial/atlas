import { space } from '@dltech/atlas-ui/tokens'
import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { ArrowUp, Square } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'

import { AttachButton } from './attach-button'
import type { EAttachSource } from './attach-sources'
import type { IComposerDictation } from './dictation/composer-dictation'
import { DictationButton } from './dictation/dictation-button'
import { composerDictationMotionOf } from './dictation/dictation-motion'
import { DictationWaveform } from './dictation/dictation-waveform'

export const ComposerControls = ({
  attach,
  sending,
  canSend,
  onStop,
  onSend,
  trailing,
  children,
  dictation,
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
  dictation?: IComposerDictation | undefined
}) => {
  const theme = useTheme()
  const attachButton =
    attach === undefined ? null : (
      <AttachButton open={attach.open} onPick={attach.onPick} onToggle={attach.onToggle} />
    )
  const slot =
    children === undefined ? null : (
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.slot}
        contentContainerStyle={styles.slotContent}
      >
        {children}
      </ScrollView>
    )
  const sendButton =
    onStop !== undefined ? (
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
    )

  if (dictation === undefined) {
    return (
      <View style={styles.bar}>
        {attachButton}
        {slot}
        {trailing}
        {sendButton}
      </View>
    )
  }

  const motion = composerDictationMotionOf(dictation.transition)

  const handleDictation = () => {
    if (dictation.active) dictation.onStop()
    else dictation.onStart()
  }

  return (
    <View style={styles.bar}>
      <View style={styles.stage}>
        {dictation.active ? (
          <Animated.View
            entering={motion.wave.entering}
            exiting={motion.wave.exiting}
            style={styles.wave}
          >
            <DictationWaveform history={dictation.history} color={theme.foreground} />
          </Animated.View>
        ) : null}
        <View style={dictation.active ? styles.idleOverlay : styles.idleRow}>
          {dictation.active || attachButton === null ? null : (
            <Animated.View entering={motion.attach.entering} exiting={motion.attach.exiting}>
              {attachButton}
            </Animated.View>
          )}
          {dictation.active || slot === null ? null : (
            <Animated.View
              entering={motion.slot.entering}
              exiting={motion.slot.exiting}
              style={styles.slotBox}
            >
              {slot}
            </Animated.View>
          )}
        </View>
      </View>
      {trailing === undefined || dictation.active ? null : (
        <Animated.View entering={motion.trailing.entering} exiting={motion.trailing.exiting}>
          {trailing}
        </Animated.View>
      )}
      <DictationButton recording={dictation.active} onPress={handleDictation} />
      {sendButton}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    justifyContent: 'space-between',
    paddingBottom: space(2),
    paddingTop: space(1.5),
  },
  idleOverlay: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    gap: space(2),
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  idleRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: space(2),
  },
  slot: {
    flex: 1,
    minWidth: 0,
  },
  slotBox: {
    flex: 1,
    minWidth: 0,
  },
  slotContent: {
    alignItems: 'center',
    gap: space(1),
  },
  stage: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
    minWidth: 0,
  },
  wave: {
    alignSelf: 'stretch',
  },
})
