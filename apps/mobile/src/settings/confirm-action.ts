import { Alert, Platform } from 'react-native'

export const confirmAction = ({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}) => {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ])
    return
  }
  if (window.confirm(message)) onConfirm()
}
