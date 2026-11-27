import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { type StyleProp, StyleSheet, type TextStyle, View } from 'react-native'

import type { ITranscript } from './transcript-model'

export const DictationField = ({
  before = '',
  transcript,
  after = '',
  style,
}: {
  before?: string
  transcript: ITranscript
  after?: string
  style?: StyleProp<TextStyle>
}) => {
  const head = `${before}${transcript.committed}`
  const gap = transcript.interim === '' || head === '' ? '' : ' '
  return (
    <View style={styles.display}>
      <Text size={ETextRole.Reading} style={style}>
        {head}
        {transcript.interim === '' ? null : (
          <Text size={ETextRole.Reading} tone={ETextTone.Muted}>
            {`${gap}${transcript.interim}`}
          </Text>
        )}
        {after === '' ? null : after}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  display: {
    minHeight: 40,
  },
})
