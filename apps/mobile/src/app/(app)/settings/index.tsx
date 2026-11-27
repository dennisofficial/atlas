import { SETTINGS_NAV, filterNav } from '@dltech/atlas-client/settings'
import {
  Button,
  CardRow,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, Platform } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { pushRegistrationLabelOf } from '../../../push/push-registration'
import { ActionRow, EActionTone, NavRow, Row, Section } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { IOS_SETTINGS_ROUTES } from '../../../settings/settings-routes'
import {
  ETestResult,
  usePermissionStatus,
  useTestNotification,
  useUpdateInfo,
} from '../../../settings/use-settings'

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

const routedGroups = () =>
  SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => IOS_SETTINGS_ROUTES[item.page] !== undefined),
  })).filter((group) => group.items.length > 0)

export default function SettingsScreen() {
  const { user, signOut, pushRegistration } = useAuth()
  const permissionStatus = usePermissionStatus()
  const testNotification = useTestNotification()
  const update = useUpdateInfo()
  const [query, setQuery] = useState('')
  const testFailed = testNotification.state.result === ETestResult.Failed
  const groups = filterNav({ groups: routedGroups(), query })

  const handleSearch = (event: { nativeEvent: { text: string } }) =>
    setQuery(event.nativeEvent.text)
  const handleCancelSearch = () => setQuery('')
  const handleOpenDictationLab = () => router.push('/dictation-lab')
  const handleOpenSystemSettings = () => void Linking.openSettings()
  const handleSignOut = () => confirmSignOut(() => void signOut())

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placement: 'integratedButton',
            placeholder: 'Search settings',
            onChangeText: handleSearch,
            onCancelButtonPress: handleCancelSearch,
          },
        }}
      />
      <Section title="Account">
        <Row label="Email" value={user?.email ?? 'Unknown account'} />
        {user?.name === undefined ? null : <Row label="Name" value={user.name} />}
      </Section>
      {groups.map((group, index) => (
        <Section key={group.label ?? `group-${index}`} title={group.label}>
          {group.items.map((item) => {
            const href = IOS_SETTINGS_ROUTES[item.page]
            if (href === undefined) return null
            return <NavRow key={item.page} label={item.label} onPress={() => router.push(href)} />
          })}
        </Section>
      ))}
      <Section title="Notifications">
        {permissionStatus === 'denied' ? (
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
              Notifications are off for Atlas.
            </Text>
            <Button
              label="Open Settings"
              variant={EButtonVariant.Outline}
              size={EButtonSize.Sm}
              onPress={handleOpenSystemSettings}
            />
          </CardRow>
        ) : (
          <CardRow>
            <Text size={ETextRole.Sm}>Permission</Text>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              {permissionStatus}
            </Text>
          </CardRow>
        )}
        <CardRow>
          <Text size={ETextRole.Sm}>This device</Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={1}>
            {pushRegistrationLabelOf(pushRegistration)}
          </Text>
        </CardRow>
        <CardRow>
          <Text
            size={ETextRole.Sm}
            tone={testFailed ? ETextTone.Destructive : ETextTone.Muted}
            style={{ flexShrink: 1 }}
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
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
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
      <Section title="Labs">
        <NavRow label="Dictation lab" onPress={handleOpenDictationLab} />
      </Section>
      <Section>
        <ActionRow label="Sign out" tone={EActionTone.Destructive} onPress={handleSignOut} />
      </Section>
    </SettingsScroll>
  )
}
