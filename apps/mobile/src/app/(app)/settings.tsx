import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import {
  ETestResult,
  usePermissionStatus,
  useTestNotification,
  useUpdateInfo,
} from '../../settings/use-settings'
import { useTheme } from '../../theme/use-theme'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const theme = useTheme()
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>{title}</Text>
      <View
        style={[styles.sectionBody, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        {children}
      </View>
    </View>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <Text style={{ color: theme.foreground }}>{label}</Text>
      <Text style={{ color: theme.mutedForeground }}>{value}</Text>
    </View>
  )
}

const ActionButton = ({
  label,
  color,
  disabled,
  onPress,
}: {
  label: string
  color: string
  disabled?: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled ?? false}
    onPress={onPress}
    style={({ pressed }) => [styles.button, { opacity: disabled === true || pressed ? 0.5 : 1 }]}
  >
    <Text style={{ color }}>{label}</Text>
  </Pressable>
)

export default function SettingsScreen() {
  const theme = useTheme()
  const { user, signOut } = useAuth()
  const permissionStatus = usePermissionStatus()
  const testNotification = useTestNotification()
  const update = useUpdateInfo()

  const handleSendTest = () => void testNotification.sendTest()

  const handleCheckUpdates = () => void update.check()

  const handleSignOut = () => {
    const confirmed =
      typeof window === 'undefined' ? true : window.confirm('Sign out of Atlas on this device?')
    if (confirmed) void signOut()
  }

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scroll}>
      <Section title="Account">
        <Row label="Email" value={user?.email ?? 'Unknown account'} />
        {user?.name !== undefined ? <Row label="Name" value={user.name} /> : null}
      </Section>
      <Section title="Notifications">
        <Row label="Permission" value={permissionStatus} />
        <ActionButton
          label="Send test notification"
          color={theme.primary}
          disabled={testNotification.state.result === ETestResult.Sending}
          onPress={handleSendTest}
        />
        {testNotification.state.detail.length > 0 ? (
          <Text
            style={{
              color:
                testNotification.state.result === ETestResult.Failed
                  ? theme.destructive
                  : theme.mutedForeground,
            }}
          >
            {testNotification.state.detail}
          </Text>
        ) : null}
      </Section>
      <Section title="Updates">
        <Row label="Channel" value={update.channel || 'unavailable'} />
        <Row label="Update" value={update.updateId} />
        <Row label="Runtime version" value={update.runtimeVersion || 'unavailable'} />
        <ActionButton
          label="Check for updates"
          color={theme.primary}
          disabled={!update.enabled || update.checking}
          onPress={handleCheckUpdates}
        />
        {update.status.length > 0 ? (
          <Text style={{ color: theme.mutedForeground }}>{update.status}</Text>
        ) : null}
      </Section>
      <Section title="Session">
        <ActionButton label="Sign out" color={theme.destructive} onPress={handleSignOut} />
      </Section>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    gap: 4,
    padding: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionBody: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    paddingVertical: 4,
  },
})
