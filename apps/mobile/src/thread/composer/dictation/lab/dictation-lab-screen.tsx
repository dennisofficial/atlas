import { space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Text, useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Host, Toggle } from '@expo/ui/swift-ui'
import { frame } from '@expo/ui/swift-ui/modifiers'
import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { FakeDictationEngine } from '../fake-dictation-engine'
import { useDictation } from '../use-dictation'
import { useGatewayDictationEngine } from '../use-gateway-dictation-engine'
import { DictationLabComposer } from './dictation-lab-composer'

const FULL_WIDTH = { maxWidth: 10000 }

enum EDictationVoice {
  Fake = 'fake',
  Real = 'real',
}

const MODEL_LABEL = 'Opus 5.5, Medium'

export const DictationLabScreen = () => {
  const theme = useTheme()
  const dark = useIsDark()
  const [voice, setVoice] = useState(EDictationVoice.Fake)
  const fake = useMemo(() => new FakeDictationEngine(), [])
  const real = useGatewayDictationEngine()
  const dictation = useDictation({
    engine: voice === EDictationVoice.Real ? real : fake,
  })

  const handleVoice = (live: boolean) =>
    setVoice(live ? EDictationVoice.Real : EDictationVoice.Fake)

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          The composer row while dictating. Turn on the real microphone, then start the mic.
        </Text>
        <Host colorScheme={dark ? 'dark' : 'light'} style={styles.toggle}>
          <Toggle
            label="Real microphone"
            isOn={voice === EDictationVoice.Real}
            onIsOnChange={handleVoice}
            modifiers={[frame(FULL_WIDTH)]}
          />
        </Host>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {voice === EDictationVoice.Real
            ? 'Your microphone streams live speech to Microsoft MAI.'
            : 'A scripted voice drives the waveform and the words.'}
        </Text>
      </ScrollView>
      <DictationLabComposer dictation={dictation} model={MODEL_LABEL} />
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: space(4),
    padding: space(4),
  },
  screen: {
    flex: 1,
  },
  toggle: {
    alignSelf: 'stretch',
    height: 36,
  },
})
