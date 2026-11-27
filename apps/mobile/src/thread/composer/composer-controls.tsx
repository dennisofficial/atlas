import { useTheme } from '@dltech/atlas-ui-native'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'

import { AttachButton } from './attach-button'
import type { EAttachSource } from './attach-sources'
import type { IComposerDictation } from './dictation/composer-dictation'
import { DictationButton } from './dictation/dictation-button'
import { composerDictationMotionOf } from './dictation/dictation-motion'
import { DictationWaveform } from './dictation/dictation-waveform'
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
  trailingPressable: boolean
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
  const sendButton = (
    <LayoutAnimationConfig skipEntering>
      {onStop !== undefined ? (
        <SendButton
          key="stop"
          action={ESendAction.Stop}
          besidePressable={trailingPressable}
          onPress={onStop}
        />
      ) : (
        <SendButton
          key="send"
          action={ESendAction.Send}
          disabled={!canSend}
          loading={sending}
          besidePressable={trailingPressable}
          onPress={onSend}
        />
      )}
    </LayoutAnimationConfig>
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
    gap: CONTROLS_GAP,
    justifyContent: 'space-between',
    paddingBottom: CONTROLS_PADDING_BOTTOM,
    paddingTop: CONTROLS_PADDING_TOP,
  },
  idleOverlay: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    gap: CONTROLS_GAP,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  idleRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: CONTROLS_GAP,
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
