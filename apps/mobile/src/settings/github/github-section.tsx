import {
  Button,
  CardRow,
  EButtonSize,
  EButtonVariant,
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Spinner,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { githubCapabilitiesOf } from '@dltech/atlas-client/settings'
import type { GithubConnectionState } from '@dltech/atlas-wire/web'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { Check, X } from 'lucide-react-native'
import { Alert, Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { Section, StatusRows } from '../settings-parts'
import { useApiResource } from '../use-api-resource'
import { EGithubFlow, useGithubConnect, type GithubFlow } from './use-github-connect'

const confirmDisconnect = (onDisconnect: () => void) => {
  const text = 'Disconnect GitHub from Atlas? Threads lose access to private repositories.'
  if (Platform.OS === 'web') {
    if (window.confirm(text)) onDisconnect()
    return
  }
  Alert.alert('Disconnect GitHub', text, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: onDisconnect },
  ])
}

const CapabilityRow = ({ label, granted }: { label: string; granted: boolean }) => {
  const theme = useTheme()
  return (
    <View style={styles.capability}>
      <Icon
        icon={granted ? Check : X}
        color={granted ? theme.primary : theme.mutedForeground}
        size={14}
      />
      <Text size={ETextRole.Xs} tone={granted ? ETextTone.Foreground : ETextTone.Muted}>
        {label}
      </Text>
    </View>
  )
}

const CodeText = ({ code }: { code: string }) => (
  <Text size={ETextRole.Base} family={EFontFamily.Mono}>
    {code}
  </Text>
)

const ConnectPanel = ({
  flow,
  onCancel,
  onRetry,
}: {
  flow: GithubFlow
  onCancel: () => void
  onRetry: () => void
}) => {
  const theme = useTheme()
  if (flow.status === EGithubFlow.Idle) return null
  if (flow.status === EGithubFlow.Starting) {
    return (
      <CardRow>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.grow}>
          Requesting a code
        </Text>
        <Spinner color={theme.primary} size={16} />
      </CardRow>
    )
  }
  if (flow.status === EGithubFlow.Failed) {
    return (
      <>
        <CardRow>
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.grow}>
            {flow.message}
          </Text>
        </CardRow>
        <CardRow>
          <Button
            label="Retry"
            variant={EButtonVariant.Outline}
            size={EButtonSize.Sm}
            onPress={onRetry}
          />
        </CardRow>
      </>
    )
  }
  const { userCode, verificationUrl } = flow.codes
  const handleCopy = () => void Clipboard.setStringAsync(userCode)
  const handleOpen = () => void WebBrowser.openBrowserAsync(verificationUrl)
  return (
    <>
      <CardRow>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.grow}>
          Enter this code on GitHub to approve Atlas.
        </Text>
      </CardRow>
      <CardRow>
        <CodeText code={userCode} />
        <Button
          label="Copy code"
          variant={EButtonVariant.Outline}
          size={EButtonSize.Sm}
          onPress={handleCopy}
        />
      </CardRow>
      <CardRow>
        <Button
          label="Open GitHub"
          variant={EButtonVariant.Outline}
          size={EButtonSize.Sm}
          onPress={handleOpen}
        />
        <Button
          label="Cancel"
          variant={EButtonVariant.Ghost}
          size={EButtonSize.Sm}
          onPress={onCancel}
        />
        <Spinner color={theme.primary} size={16} />
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          Waiting for approval
        </Text>
      </CardRow>
    </>
  )
}

const GithubStatus = ({
  connection,
  onChanged,
}: {
  connection: GithubConnectionState
  onChanged: () => void
}) => {
  const { api } = useAuth()
  const control = useGithubConnect({ api, onChanged })
  const connected = connection.connected
  const login = connected ? connection.login : null
  const missing = connected ? connection.missingScopes : []
  const busy = control.disconnecting || control.flow.status !== EGithubFlow.Idle
  const handleDisconnect = () => confirmDisconnect(control.disconnect)

  return (
    <>
      <CardRow>
        <View style={styles.copy}>
          <Text size={ETextRole.Sm}>GitHub</Text>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            {login === null ? 'Disconnected' : `Connected as ${login}`}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            label={connected ? 'Reconnect' : 'Connect GitHub'}
            variant={
              connected && missing.length === 0 ? EButtonVariant.Outline : EButtonVariant.Default
            }
            size={EButtonSize.Sm}
            disabled={busy}
            onPress={control.connect}
          />
          {connected ? (
            <Button
              label="Disconnect"
              variant={EButtonVariant.Outline}
              size={EButtonSize.Sm}
              disabled={busy}
              onPress={handleDisconnect}
            />
          ) : null}
        </View>
      </CardRow>
      <CardRow>
        <View style={styles.capabilities}>
          {githubCapabilitiesOf(connection).map((capability) => (
            <CapabilityRow
              key={capability.label}
              label={capability.label}
              granted={capability.granted && connected}
            />
          ))}
        </View>
      </CardRow>
      {missing.length === 0 || control.flow.status !== EGithubFlow.Idle ? null : (
        <CardRow>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            Reconnect to grant {missing.join(', ')}
          </Text>
        </CardRow>
      )}
      <ConnectPanel flow={control.flow} onCancel={control.cancel} onRetry={control.connect} />
    </>
  )
}

export const GithubSection = () => {
  const { api } = useAuth()
  const { state, data, reload } = useApiResource<GithubConnectionState>({
    load: async () => {
      if (api === undefined) throw new Error('Not signed in')
      return api.github.get.query()
    },
    deps: [api],
  })

  return (
    <Section title="Integrations">
      <StatusRows
        state={state}
        onRetry={reload}
        failure="The GitHub connection could not be loaded."
      />
      {data === null ? null : (
        <GithubStatus key={String(data.connected)} connection={data} onChanged={reload} />
      )}
    </Section>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(0.5),
  },
  grow: {
    flexShrink: 1,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  capabilities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(2),
  },
  capability: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1),
  },
})
