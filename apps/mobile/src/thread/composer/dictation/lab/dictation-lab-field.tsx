import { ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { readingType } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import type { ITranscript } from '../transcript-model'

const PLACEHOLDER = 'Ask the agent to change your code...'

const DictatedText = ({ transcript }: { transcript: ITranscript }) => (
  <Text size={ETextRole.Reading}>
    {transcript.committed}
    {transcript.interim === '' ? null : (
      <Text size={ETextRole.Reading} tone={ETextTone.Muted}>
        {`${transcript.committed === '' ? '' : ' '}${transcript.interim}`}
      </Text>
    )}
  </Text>
)

export const DictationLabField = ({
  dictating,
  transcript,
  draft,
  onChangeDraft,
}: {
  dictating: boolean
  transcript: ITranscript
  draft: string
  onChangeDraft: (text: string) => void
}) => {
  if (dictating) {
    return (
      <View style={styles.display}>
        <DictatedText transcript={transcript} />
      </View>
    )
  }
  return (
    <Input
      bare
      multiline
      accessibilityLabel="Message Atlas"
      placeholder={PLACEHOLDER}
      value={draft}
      onChangeText={onChangeDraft}
      style={styles.input}
    />
  )
}

const styles = StyleSheet.create({
  display: {
    minHeight: 40,
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
