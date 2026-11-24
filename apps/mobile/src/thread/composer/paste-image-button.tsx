import { useTheme } from '@dltech/atlas-ui-native'
import {
  ClipboardPasteButton,
  isPasteButtonAvailable,
  type PasteEventPayload,
} from 'expo-clipboard'
import { StyleSheet } from 'react-native'

const SIZE = 36

export const PasteImageButton = ({ onImage }: { onImage: (data: string) => void }) => {
  const theme = useTheme()
  if (!isPasteButtonAvailable) return null

  const handlePaste = (payload: PasteEventPayload) => {
    if (payload.type !== 'image') return
    onImage(payload.data)
  }

  return (
    <ClipboardPasteButton
      accessibilityLabel="Paste an image"
      acceptedContentTypes={['image']}
      imageOptions={{ format: 'png' }}
      displayMode="iconOnly"
      cornerStyle="capsule"
      backgroundColor={theme.secondary}
      foregroundColor={theme.foreground}
      onPress={handlePaste}
      style={styles.button}
    />
  )
}

const styles = StyleSheet.create({
  button: {
    height: SIZE,
    width: SIZE,
  },
})
