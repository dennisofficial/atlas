import { Button, Form, Host, Section, Text } from '@expo/ui/swift-ui'
import { buttonStyle, disabled, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import { Alert } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import {
  ETestResult,
  usePermissionStatus,
  useTestNotification,
  useUpdateInfo,
} from '../../settings/use-settings'

export default function SettingsScreen() {
  const { user, signOut } = useAuth()
  const permissionStatus = usePermissionStatus()
  const testNotification = useTestNotification()
  const update = useUpdateInfo()

  const handleSendTest = () => void testNotification.sendTest()

  const handleCheckUpdates = () => void update.check()

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Sign out of Atlas on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <Host style={{ flex: 1 }}>
      <Form>
        <Section title="Account">
          <Text modifiers={[foregroundStyle('secondary')]}>{user?.email ?? 'Unknown account'}</Text>
          {user?.name !== undefined ? (
            <Text modifiers={[foregroundStyle('secondary')]}>{user.name}</Text>
          ) : null}
        </Section>
        <Section title="Notifications">
          <Text modifiers={[foregroundStyle('secondary')]}>Permission: {permissionStatus}</Text>
          <Button
            label="Send test notification"
            onPress={handleSendTest}
            modifiers={[disabled(testNotification.state.result === ETestResult.Sending)]}
          />
          {testNotification.state.detail.length > 0 ? (
            <Text
              modifiers={[
                foregroundStyle(
                  testNotification.state.result === ETestResult.Failed ? 'red' : 'secondary',
                ),
              ]}
            >
              {testNotification.state.detail}
            </Text>
          ) : null}
        </Section>
        <Section title="Updates">
          <Text modifiers={[foregroundStyle('secondary')]}>Channel: {update.channel}</Text>
          <Text modifiers={[foregroundStyle('secondary')]}>Update: {update.updateId}</Text>
          <Text modifiers={[foregroundStyle('secondary')]}>
            Runtime version: {update.runtimeVersion}
          </Text>
          <Button
            label="Check for updates"
            onPress={handleCheckUpdates}
            modifiers={[disabled(!update.enabled || update.checking), buttonStyle('bordered')]}
          />
          {update.status.length > 0 ? (
            <Text modifiers={[foregroundStyle('secondary')]}>{update.status}</Text>
          ) : null}
        </Section>
        <Section>
          {/* biome-ignore lint/a11y/useValidAriaRole: SwiftUI button role (default/cancel/destructive), not an ARIA role */}
          <Button label="Sign out" role="destructive" onPress={handleSignOut} />
        </Section>
      </Form>
    </Host>
  )
}
