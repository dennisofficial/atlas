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
import { OperatorInputCard } from '../../../thread/composer/operator-input-card'
import { StaleCard } from '../../../thread/composer/stale-card'
import { useAttachments } from '../../../thread/composer/use-attachments'
import { Transcript } from '../../../thread/components/transcript'
import { useThread } from '../../../thread/data/use-thread'

const HEADER_HEIGHT = Platform.OS === 'ios' ? 100 : 64

export default function ThreadScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const thread = useThread(id)
  const attachments = useAttachments()
  const title = thread.failedToLoad ? '' : (thread.title ?? '')

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title }} />
      {!thread.loaded && !thread.failedToLoad ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : null}
      {thread.failedToLoad ? (
        <View style={styles.center}>
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            This session could not be loaded.
          </Text>
        </View>
      ) : null}
      {thread.loaded ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={HEADER_HEIGHT}
          style={styles.fill}
        >
          <Transcript rows={thread.rows} working={thread.working} now={thread.now} threadId={id} />
          {thread.failure === null ? null : (
            <View style={styles.failure}>
              <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.failureText}>
                {thread.failure}
              </Text>
              <Button
                label="Retry"
                size={EButtonSize.Sm}
                variant={EButtonVariant.Outline}
                onPress={thread.retry}
              />
            </View>
          )}
          <View style={{ paddingBottom: insets.bottom }}>
            {thread.stale ? (
              <View style={styles.operator}>
                <StaleCard />
              </View>
            ) : null}
            {thread.operatorInput === null ? null : (
              <View style={styles.operator}>
                <OperatorInputCard
                  key={thread.operatorInput.requestId}
                  request={thread.operatorInput}
                  onSubmit={thread.submitOperatorInput}
                />
              </View>
            )}
            <Composer
              working={thread.working}
              attachments={attachments}
              onSend={thread.send}
              onStop={thread.stop}
            />
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
})
