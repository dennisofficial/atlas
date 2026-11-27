import { space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Text, useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Host, Picker, Text as SwiftText, Toggle } from '@expo/ui/swift-ui'
import { frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { DICTATION_TRANSITIONS, EDictationTransition } from '../composer-dictation'
import { useDictation } from '../use-dictation'
import { useDictationEngines } from '../use-dictation-engines'
import { DictationLabComposer } from './dictation-lab-composer'

const FULL_WIDTH = { maxWidth: 10000 }

enum EDictationVoice {
  Fake = 'fake',
  Mic = 'mic',
}

const MODEL_LABEL = 'Opus 5.5 · Medium'

export const DictationLabScreen = () => {
  const theme = useTheme()
  const dark = useIsDark()
  const [transition, setTransition] = useState(EDictationTransition.SwipeLeft)
  const [voice, setVoice] = useState(EDictationVoice.Fake)
  const engines = useDictationEngines()
  const dictation = useDictation({
    engine: voice === EDictationVoice.Mic ? engines.mic : engines.fake,
  })

  const handleTransition = (next: EDictationTransition) => setTransition(next)

  const handleVoice = (mic: boolean) => setVoice(mic ? EDictationVoice.Mic : EDictationVoice.Fake)

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          The composer row while dictating. Pick a transition, then start the mic.
        </Text>
        <View style={styles.controls}>
          <Host colorScheme={dark ? 'dark' : 'light'} style={styles.picker}>
            <Picker<EDictationTransition>
              selection={transition}
              onSelectionChange={handleTransition}
              modifiers={[pickerStyle('segmented'), frame(FULL_WIDTH)]}
            >
              {DICTATION_TRANSITIONS.map((item) => (
                <SwiftText key={item.value} modifiers={[tag(item.value)]}>
                  {item.title}
                </SwiftText>
              ))}
            </Picker>
          </Host>
          <Host colorScheme={dark ? 'dark' : 'light'} style={styles.toggle}>
            <Toggle
              label="My mic"
              isOn={voice === EDictationVoice.Mic}
              onIsOnChange={handleVoice}
              modifiers={[frame(FULL_WIDTH)]}
            />
          </Host>
        </View>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {voice === EDictationVoice.Mic
            ? 'Your microphone drives the waveform. The words are still a script.'
            : 'A scripted voice drives the waveform and the words.'}
        </Text>
      </ScrollView>
      <DictationLabComposer dictation={dictation} transition={transition} model={MODEL_LABEL} />
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: space(4),
    padding: space(4),
  },
  controls: {
    gap: space(3),
  },
  picker: {
    alignSelf: 'stretch',
    height: 36,
  },
  screen: {
    flex: 1,
  },
  toggle: {
    alignSelf: 'stretch',
    height: 36,
  },
})
