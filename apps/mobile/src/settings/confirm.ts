import { Alert, Platform } from 'react-native'

export const confirmDestructive = ({
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}): void => {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ])
    return
  }
  if (window.confirm(`${title}\n\n${message}`)) onConfirm()
}
