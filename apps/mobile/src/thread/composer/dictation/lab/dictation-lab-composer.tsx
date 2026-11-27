import { readingType } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Input, Text, useTheme } from '@dltech/atlas-ui-native'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { GlassSurface } from '../../../../navigation/glass-surface'
import { ComposerControls } from '../../composer-controls'
import { COMPOSER_INSET, COMPOSER_RADIUS } from '../../composer-shape'
import { DictationField } from '../dictation-field'
import { transcriptTextOf } from '../transcript-model'
import type { IDictation } from '../use-dictation'

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
  model,
}: {
  dictation: IDictation
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
          {dictation.active ? (
            <DictationField transcript={dictation.transcript} />
          ) : (
            <Input
              bare
              multiline
              accessibilityLabel="Message Atlas"
              placeholder="Ask the agent to change your code..."
              value={draft}
              onChangeText={setDraft}
              style={styles.input}
            />
          )}
          <ComposerControls
            attach={{ open: false, onPick: handleNothing, onToggle: handleNothing }}
            sending={false}
            canSend={draft !== ''}
            onStop={undefined}
            onSend={handleSend}
            trailingPressable={false}
            dictation={{
              active: dictation.active,
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
  surface: {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
  },
  note: {
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  input: {
    fontFamily: 'Geist_400Regular',
    fontSize: readingType.body.fontSize,
    lineHeight: readingType.body.lineHeight,
    maxHeight: 160,
    minHeight: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
})
