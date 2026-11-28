import { Button, EFontWeight, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { ErrorBoundaryProps } from 'expo-router'
import { usePostHog } from 'posthog-react-native'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

export const CrashScreen = ({ error, retry }: ErrorBoundaryProps) => {
  const theme = useTheme()
  const posthog = usePostHog()

  useEffect(() => {
    posthog?.captureException(error, { $exception_source: 'root-error-boundary' })
  }, [posthog, error])

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Text size={ETextRole.Lg} weight={EFontWeight.Medium}>
        Atlas hit an error
      </Text>
      <ScrollView scrollsToTop={false} style={styles.detail}>
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive} selectable>
          {error.message}
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} selectable>
          {error.stack ?? ''}
        </Text>
      </ScrollView>
      <Button label="Try again" onPress={() => void retry()} stretch />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: space(3),
    justifyContent: 'center',
    padding: space(6),
  },
  detail: {
    flexGrow: 0,
    maxHeight: 320,
  },
})
