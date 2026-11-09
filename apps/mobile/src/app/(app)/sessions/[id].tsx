import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Composer } from '../../../thread/composer/composer'
import { StaleCard } from '../../../thread/composer/stale-card'
import { Transcript } from '../../../thread/components/transcript'
import { useV2SessionScreen } from '../../../thread/v2/use-v2-session-screen'

const HEADER_HEIGHT = Platform.OS === 'ios' ? 100 : 64

export default function SessionScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>()
  const session = useV2SessionScreen(id)

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: session.failedToLoad ? '' : (title ?? '') }} />
      {!session.loaded && !session.failedToLoad ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : null}
      {session.failedToLoad ? (
        <View style={styles.center}>
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            This session could not be loaded.
          </Text>
        </View>
      ) : null}
      {session.loaded ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={HEADER_HEIGHT}
          style={styles.fill}
        >
          <Transcript
            rows={session.rows}
            working={session.working}
            now={session.now}
            threadId={id}
          />
          {session.failure === null ? null : (
            <View style={styles.failure}>
              <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.failureText}>
                {session.failure}
              </Text>
              <Button
                label="Retry"
                size={EButtonSize.Sm}
                variant={EButtonVariant.Outline}
                onPress={session.retry}
              />
            </View>
          )}
          <View style={{ paddingBottom: insets.bottom }}>
            {session.stale ? (
              <View style={styles.operator}>
                <StaleCard />
              </View>
            ) : null}
            {session.stateLine === null ? null : (
              <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.state}>
                {session.stateLine}
              </Text>
            )}
            <Composer working={session.working} onSend={session.send} onStop={session.stop} />
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: space(2),
    justifyContent: 'center',
  },
  failure: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingBottom: space(2),
    paddingHorizontal: space(4),
  },
  failureText: {
    flex: 1,
  },
  operator: {
    paddingBottom: space(2),
    paddingHorizontal: space(3),
  },
  state: {
    paddingBottom: space(1),
    paddingHorizontal: space(4),
  },
})
