import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { GlassSurface } from '../../../../navigation/glass-surface'
import { ComposerControls } from '../../composer-controls'
import { COMPOSER_INSET, COMPOSER_RADIUS } from '../../composer-shape'
import type { EDictationTransition } from '../composer-dictation'
import { transcriptTextOf } from '../transcript-model'
import type { IDictation } from '../use-dictation'
import { DictationLabField } from './dictation-lab-field'

const handleNothing = () => undefined

const ModelChip = ({ label }: { label: string }) => {
  const theme = useTheme()
  return (
    <View style={[styles.chip, { backgroundColor: theme.secondary, borderColor: theme.border }]}>
      <Text size={ETextRole.Xs} color={theme.secondaryForeground}>
        {label}
      </Text>
    </View>
  )
}

export const DictationLabComposer = ({
  dictation,
  transition,
  model,
}: {
  dictation: IDictation
  transition: EDictationTransition
  model: string
}) => {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const text = transcriptTextOf(dictation.transcript)
    if (text !== '') setDraft(text)
  }, [dictation.transcript])

  const handleSend = () => {
    setDraft('')
    dictation.cancel()
  }

  return (
    <View style={styles.dock}>
      <GlassSurface style={styles.surface}>
        <View style={styles.field}>
          <DictationLabField
            dictating={dictation.active}
            transcript={dictation.transcript}
            draft={draft}
            onChangeDraft={setDraft}
          />
          <ComposerControls
            attach={{ open: false, onPick: handleNothing, onToggle: handleNothing }}
            sending={false}
            canSend={draft !== ''}
            onStop={undefined}
            onSend={handleSend}
            trailingPressable={false}
            dictation={{
              active: dictation.active,
              transition,
              history: dictation.history,
              onStart: dictation.start,
              onStop: dictation.stop,
            }}
          >
            <ModelChip label={model} />
          </ComposerControls>
        </View>
      </GlassSurface>
      {dictation.error === null ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.note}>
          {dictation.error}
        </Text>
      )}
      <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.note}>
        Stop keeps the words. Send sends and clears them.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dock: {
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  field: {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
    paddingHorizontal: COMPOSER_INSET,
    paddingTop: COMPOSER_INSET,
  },
  note: {
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  surface: {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
  },
})
