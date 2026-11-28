import {
  type IAuthAccountApi,
  type ISignedInDevice,
  signedInDevicesOf,
} from '@dltech/atlas-client/settings'
import {
  Button,
  CardRow,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { useAccountApi } from '../../../settings/account/use-account-api'
import { confirmDestructive } from '../../../settings/confirm'
import { ActionRow, EActionTone, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'

const loadDevices = async (authApi: IAuthAccountApi): Promise<ISignedInDevice[]> => {
  const [sessions, current] = await Promise.all([
    authApi.listSessions(),
    authApi.getCurrentSession(),
  ])
  return signedInDevicesOf({ sessions, currentToken: current.session?.token ?? null })
}

const DeviceRows = ({
  devices,
  authApi,
  reload,
}: {
  devices: ISignedInDevice[]
  authApi: IAuthAccountApi
  reload: () => void
}) => {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const run = async ({ work, success }: { work: () => Promise<void>; success: string }) => {
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      await work()
      setNotice(success)
      reload()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = (device: ISignedInDevice) =>
    confirmDestructive({
      title: `Revoke ${device.name}?`,
      message: 'This device is signed out immediately and must sign in again to use Atlas.',
      confirmLabel: 'Revoke',
      onConfirm: () =>
        void run({ work: () => authApi.revokeSession(device.id), success: 'Session revoked' }),
    })

  const handleRevokeOthers = () =>
    confirmDestructive({
      title: 'Sign out of all other devices?',
      message:
        'Every browser, CLI, TUI, and sandbox session except this one is revoked. Each will need to sign in again.',
      confirmLabel: 'Sign out others',
      onConfirm: () =>
        void run({
          work: () => authApi.revokeOtherSessions(),
          success: 'Signed out of other devices',
        }),
    })

  return (
    <>
      <Section title="Signed-in devices">
        {devices.map((device) => (
          <CardRow key={device.id}>
            <View style={styles.device}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Text size={ETextRole.Sm}>{device.name}</Text>
                {device.current ? (
                  <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                    This device
                  </Text>
                ) : null}
              </View>
              <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.meta}>
                {device.meta}
              </Text>
            </View>
            {device.current ? null : (
              <Button
                label="Revoke"
                variant={EButtonVariant.Outline}
                size={EButtonSize.Sm}
                disabled={busy}
                onPress={() => handleRevoke(device)}
              />
            )}
          </CardRow>
        ))}
      </Section>
      <Section>
        <ActionRow
          label="Sign out of all other devices"
          tone={EActionTone.Destructive}
          loading={busy}
          onPress={handleRevokeOthers}
        />
      </Section>
      {notice === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {notice}
        </Text>
      )}
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
    </>
  )
}

export default function SecurityScreen() {
  const authApi = useAccountApi()
  const { state, data, reload } = useApiResource({
    load: async () => {
      if (authApi === undefined) throw new Error('You are signed out')
      return loadDevices(authApi)
    },
    deps: [authApi],
  })

  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="Your devices could not be loaded." />
      {data === null || authApi === undefined ? null : (
        <DeviceRows devices={data} authApi={authApi} reload={reload} />
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  device: {
    flexShrink: 1,
    gap: space(0.5),
  },
  meta: {
    flexShrink: 1,
  },
})
