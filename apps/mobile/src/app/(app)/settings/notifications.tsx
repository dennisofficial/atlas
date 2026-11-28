import {
  deviceTimezone,
  type NotificationSettings,
  NOTIFY_MOMENTS,
  type NotifyMomentId,
  NOTIFY_TIMEZONE_KEY,
  notificationChanges,
  notificationsFrom,
  notifyDeviceDetailOf,
  QUIET_HOUR_OPTIONS,
  withDeviceEnabled,
} from '@dltech/atlas-client/settings'
import type { NotifyDeviceView } from '@dltech/atlas-wire'
import {
  Button,
  CardRow,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, StyleSheet } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { pushRegistrationLabelOf } from '../../../push/push-registration'
import { EResourceState } from '../../../settings/api-resource-state'
import { ChoiceRow } from '../../../settings/choice-row'
import { NavRow, Row, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'
import { SwitchRow } from '../../../settings/switch-row'
import { useApiResource } from '../../../settings/use-api-resource'
import {
  ETestResult,
  usePermissionStatus,
  useTestNotification,
} from '../../../settings/use-settings'

const PAGE_DESCRIPTION = 'Decide where Atlas gets your attention.'
const EMPTY_DEVICES: readonly NotifyDeviceView[] = []

export default function NotificationsScreen() {
  const { api, pushRegistration } = useAuth()
  const settings = useSettings()
  const permissionStatus = usePermissionStatus()
  const testNotification = useTestNotification()
  const {
    state: devicesState,
    data: devicesData,
    reload: reloadDevices,
  } = useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve(EMPTY_DEVICES)
        : api.notifications.listDevices.query({}).then((body) => body.devices),
    deps: [api],
  })
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const defaulted = useRef(false)
  const saved = notificationsFrom(settings.values)
  const timezone = saved.timezone === '' ? deviceTimezone() : saved.timezone
  const devices = devicesData ?? EMPTY_DEVICES
  const testFailed = testNotification.state.result === ETestResult.Failed

  useFocusEffect(
    useCallback(() => {
      reloadDevices()
    }, [reloadDevices]),
  )

  useEffect(() => {
    if (!settings.ready || defaulted.current) return
    defaulted.current = true
    if (saved.timezone !== '') return
    void settings.save({ [NOTIFY_TIMEZONE_KEY]: deviceTimezone() }).catch(() => undefined)
  }, [settings, saved.timezone])

  const handleChange = (draft: NotificationSettings) => {
    const changes = notificationChanges({ saved, draft })
    if (!settings.ready || Object.keys(changes).length === 0) return
    setFailure(null)
    void settings.save(changes).catch(() => setFailure('That change could not be saved.'))
  }

  const handleEventToggle = ({ moment, enabled }: { moment: NotifyMomentId; enabled: boolean }) =>
    handleChange({ ...saved, events: { ...saved.events, [moment]: enabled } })

  const handleDeviceToggle = async ({
    deviceId,
    enabled,
  }: {
    deviceId: string
    enabled: boolean
  }) => {
    if (api === undefined) return
    const record = (next: boolean) =>
      setOverrides((current) => withDeviceEnabled({ overrides: current, deviceId, enabled: next }))
    record(enabled)
    setFailure(null)
    try {
      await api.notifications.setDeviceEnabled.mutate({ deviceId, enabled })
    } catch {
      record(!enabled)
      setFailure('That device could not be changed.')
    }
  }

  const handleOpenTimezone = () => router.push('/settings/notifications-timezone')
  const handleOpenSystemSettings = () => void Linking.openSettings()
  const handleSendTest = () => void testNotification.sendTest()

  return (
    <SettingsScroll>
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {PAGE_DESCRIPTION}
      </Text>
      <StatusRows
        state={
          settings.failed
            ? EResourceState.Failed
            : settings.ready
              ? EResourceState.Ready
              : EResourceState.Loading
        }
        onRetry={settings.reload}
        failure="Your notification settings could not be loaded."
      />
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      <Section title="This device">
        <Row label="Permission" value={permissionStatus} />
        <Row label="This device" value={pushRegistrationLabelOf(pushRegistration)} />
        {permissionStatus === 'denied' ? (
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.copy}>
              Notifications are off for Atlas. Allow them in the system settings.
            </Text>
            <Button
              label="Open Settings"
              variant={EButtonVariant.Outline}
              size={EButtonSize.Sm}
              onPress={handleOpenSystemSettings}
            />
          </CardRow>
        ) : null}
        <CardRow>
          <Text
            size={ETextRole.Sm}
            tone={testFailed ? ETextTone.Destructive : ETextTone.Muted}
            style={styles.copy}
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
            onPress={handleSendTest}
          />
        </CardRow>
      </Section>
      <Section title="Notify me when">
        {NOTIFY_MOMENTS.map((moment) => (
          <SwitchRow
            key={moment.id}
            label={moment.title}
            detail={moment.description}
            value={saved.events[moment.id]}
            disabled={!settings.ready}
            onValueChange={(enabled) => handleEventToggle({ moment: moment.id, enabled })}
          />
        ))}
      </Section>
      <StatusRows
        state={devicesState}
        onRetry={reloadDevices}
        failure="Your devices could not be loaded."
      />
      {devicesState !== EResourceState.Ready ? null : (
        <Section title="Devices">
          {devices.length === 0 ? (
            <CardRow>
              <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.copy}>
                No devices yet. Turn notifications on in an Atlas app or a browser and the device
                appears here.
              </Text>
            </CardRow>
          ) : (
            devices.map((device) => {
              const enabled = overrides[device.id] ?? device.enabled
              return (
                <SwitchRow
                  key={device.id}
                  label={device.label}
                  detail={notifyDeviceDetailOf({ kind: device.kind, enabled })}
                  value={enabled}
                  onValueChange={(next) =>
                    void handleDeviceToggle({ deviceId: device.id, enabled: next })
                  }
                />
              )
            })
          )}
        </Section>
      )}
      <Section title="Quiet hours">
        <SwitchRow
          label="Quiet hours"
          detail="Hold every notification during this window."
          value={saved.quietHours}
          disabled={!settings.ready}
          onValueChange={(quietHours) => handleChange({ ...saved, quietHours })}
        />
        {saved.quietHours ? (
          <>
            <ChoiceRow
              label="From"
              value={saved.quietFrom}
              options={QUIET_HOUR_OPTIONS}
              onChange={(quietFrom) => handleChange({ ...saved, quietFrom })}
            />
            <ChoiceRow
              label="To"
              value={saved.quietTo}
              options={QUIET_HOUR_OPTIONS}
              onChange={(quietTo) => handleChange({ ...saved, quietTo })}
            />
          </>
        ) : null}
        <NavRow label="Time zone" value={timezone} onPress={handleOpenTimezone} />
      </Section>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
  },
})
