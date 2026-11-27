import { useTheme } from '@dltech/atlas-ui-native'
import { Stack } from 'expo-router'

export default function PhotoLayout() {
  const theme = useTheme()
  return <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }} />
}
