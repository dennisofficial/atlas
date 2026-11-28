import { Alert, Platform } from 'react-native'

export const confirmDelete = ({
  title,
  message,
  onConfirm,
}: {
  title: string
  message: string
  onConfirm: () => void
}) => {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ])
    return
  }
  if (window.confirm(`${title}\n\n${message}`)) onConfirm()
}
