import {
  Button,
  CardList,
  CardRow,
  EButtonSize,
  EButtonVariant,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { ReactNode } from 'react'
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import {
  ETestResult,
  usePermissionStatus,
  useTestNotification,
  useUpdateInfo,
} from '../../settings/use-settings'

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <View style={styles.section}>
    <Text size={ETextRole.Sm} weight={EFontWeight.Medium} style={styles.sectionTitle}>
      {title}
    </Text>
    <CardList>{children}</CardList>
  </View>
)

const Row = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <CardRow>
    <Text size={ETextRole.Sm}>{label}</Text>
    <Text
      size={ETextRole.Sm}
      tone={ETextTone.Muted}
      family={mono ? EFontFamily.Mono : EFontFamily.Sans}
      numberOfLines={1}
      style={styles.value}
    >
      {value}
    </Text>
  </CardRow>
)

const confirmSignOut = (signOut: () => void) => {
  if (Platform.OS !== 'web') {
    Alert.alert('Sign out', 'Sign out of Atlas on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ])
    return
  }
  if (window.confirm('Sign out of Atlas on this device?')) signOut()
}

export default function SettingsScreen() {
  const theme = useTheme()
  const { user, signOut } = useAuth()
  const permissionStatus = usePermissionStatus()
  const testNotification = useTestNotification()
  const update = useUpdateInfo()
  const testFailed = testNotification.state.result === ETestResult.Failed

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scroll}>
      <Section title="Account">
        <Row label="Email" value={user?.email ?? 'Unknown account'} />
        {user?.name !== undefined ? <Row label="Name" value={user.name} /> : null}
      </Section>
      <Section title="Notifications">
        <Row label="Permission" value={permissionStatus} />
        <CardRow>
          <Text
            size={ETextRole.Sm}
            tone={testFailed ? ETextTone.Destructive : ETextTone.Muted}
            style={styles.value}
          >
            {testNotification.state.detail.length > 0
              ? testNotification.state.detail
              : 'Send yourself a test push.'}
          </Text>
          <Button
            label="Send test notification"
            variant={EButtonVariant.Outline}
            size={EButtonSize.Sm}
            loading={testNotification.state.result === ETestResult.Sending}
            onPress={() => void testNotification.sendTest()}
          />
        </CardRow>
      </Section>
      <Section title="Updates">
        <Row label="Channel" value={update.channel || 'unavailable'} mono />
        <Row label="Update" value={update.updateId} mono />
        <Row label="Runtime version" value={update.runtimeVersion || 'unavailable'} mono />
        <CardRow>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.value}>
            {update.status}
          </Text>
          <Button
            label="Check for updates"
            variant={EButtonVariant.Outline}
            size={EButtonSize.Sm}
            disabled={!update.enabled}
            loading={update.checking}
            onPress={() => void update.check()}
          />
        </CardRow>
      </Section>
      <Button
        label="Sign out"
        variant={EButtonVariant.Destructive}
        onPress={() => confirmSignOut(() => void signOut())}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    gap: space(6),
    padding: space(4),
    paddingBottom: space(10),
  },
  section: {
    gap: space(2),
  },
  sectionTitle: {
    paddingHorizontal: space(1),
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
})
