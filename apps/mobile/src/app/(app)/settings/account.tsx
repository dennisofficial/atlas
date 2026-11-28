import {
  ESignInMethodAction,
  ESignInMethodProvider,
  GOOGLE_UNLINKED,
  PASSWORD_REMOVED,
  SETUP_LINK_SENT,
  signInMethodRowsOf,
  type IAuthAccountApi,
  type ISignInMethodRow,
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
import { router, Stack, useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { loadAccountData, type IAccountData } from '../../../settings/account/account-data'
import { useAccountApi } from '../../../settings/account/use-account-api'
import { confirmDestructive } from '../../../settings/confirm'
import { Row, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'
import { webOrigin } from '../../../config'

const NOT_AVAILABLE = '—'

const titlesOf = (row: ISignInMethodRow): { title: string; message: string } => {
  if (row.provider === ESignInMethodProvider.Google) {
    return {
      title: 'Unlink Google?',
      message: 'You will sign in with your password only.',
    }
  }
  return {
    title: 'Remove password?',
    message: 'You will sign in with Google only.',
  }
}

const AccountContent = ({
  data,
  authApi,
  reload,
}: {
  data: IAccountData
  authApi: IAuthAccountApi
  reload: () => void
}) => {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const rows = signInMethodRowsOf({ methods: data.signInMethods, busy })

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

  const handleSendSetupLink = () =>
    void run({
      work: () =>
        authApi.requestPasswordReset({
          email: data.email,
          redirectTo: `${webOrigin}/reset-password`,
        }),
      success: SETUP_LINK_SENT,
    })

  const handleUnlink = (row: ISignInMethodRow, accountId: string) => {
    const { title, message } = titlesOf(row)
    const success =
      row.provider === ESignInMethodProvider.Google ? GOOGLE_UNLINKED : PASSWORD_REMOVED
    confirmDestructive({
      title,
      message,
      confirmLabel: row.actionLabel,
      onConfirm: () => void run({ work: () => authApi.unlinkAccount(accountId), success }),
    })
  }

  const handleMethod = (row: ISignInMethodRow) => {
    if (row.action === ESignInMethodAction.SendSetupLink) {
      handleSendSetupLink()
      return
    }
    const accountId =
      row.provider === ESignInMethodProvider.Google
        ? data.signInMethods.google
        : data.signInMethods.password
    if (accountId === null) return
    handleUnlink(row, accountId)
  }

  return (
    <>
      <Section title="Profile">
        <Row label="Name" value={data.name} />
        <Row label="Email" value={data.email} />
        <Row label="GitHub" value={data.githubLogin ?? 'Not connected'} mono />
        <Row label="Threads" value={NOT_AVAILABLE} mono />
        <Row label="Member since" value={data.memberSince ?? NOT_AVAILABLE} />
      </Section>
      <Section title="Sign-in methods">
        {rows.map((row) => (
          <CardRow key={row.provider}>
            <View style={styles.method}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Text size={ETextRole.Sm}>{row.label}</Text>
                <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                  {row.badge}
                </Text>
              </View>
              <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                {row.description}
              </Text>
            </View>
            {row.action === ESignInMethodAction.Link ? null : (
              <Button
                label={row.actionLabel}
                variant={row.primary ? EButtonVariant.Default : EButtonVariant.Outline}
                size={EButtonSize.Sm}
                disabled={row.disabled}
                onPress={() => handleMethod(row)}
              />
            )}
          </CardRow>
        ))}
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

export default function AccountScreen() {
  const { api } = useAuth()
  const authApi = useAccountApi()
  const { state, data, reload } = useApiResource({
    load: async () => {
      if (api === undefined || authApi === undefined) throw new Error('You are signed out')
      return loadAccountData({ api, authApi })
    },
    deps: [api, authApi],
  })
  const firstFocus = useRef(true)

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false
        return
      }
      reload()
    }, [reload]),
  )

  const handleOpenEdit = () => router.push('/settings/account/edit')

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          unstable_headerRightItems: () =>
            Platform.OS === 'ios'
              ? [
                  {
                    type: 'button',
                    label: 'Edit',
                    icon: { type: 'sfSymbol', name: 'pencil' },
                    accessibilityLabel: 'Edit profile',
                    onPress: handleOpenEdit,
                  },
                ]
              : [],
          headerRight:
            Platform.OS === 'ios'
              ? undefined
              : () => (
                  <Button
                    label="Edit"
                    variant={EButtonVariant.Ghost}
                    size={EButtonSize.Sm}
                    onPress={handleOpenEdit}
                  />
                ),
        }}
      />
      <StatusRows state={state} onRetry={reload} failure="Your account could not be loaded." />
      {data === null || authApi === undefined ? null : (
        <AccountContent data={data} authApi={authApi} reload={reload} />
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  method: {
    flexShrink: 1,
    gap: space(0.5),
  },
})
