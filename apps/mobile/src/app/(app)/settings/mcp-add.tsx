import {
  Button,
  Card,
  ETextRole,
  ETextTone,
  Input,
  Spinner,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import {
  mcpDraftIsValid,
  mcpServerPutInputOf,
  serverIdOf,
  type McpServerDraft,
} from '@dltech/atlas-client/settings'
import { EMcpTransportKind } from '@dltech/atlas-wire/web'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { ChoiceRow } from '../../../settings/choice-row'
import { mcpScopeOfParams, type McpAddParams } from '../../../settings/mcp/mcp-add-scope'
import { Section } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { SwitchRow } from '../../../settings/switch-row'

const TRANSPORTS = [
  { value: EMcpTransportKind.Stdio, label: 'Command (stdio)' },
  { value: EMcpTransportKind.Http, label: 'Remote (HTTP)' },
]

export default function AddMcpServerScreen() {
  const { api } = useAuth()
  const params = useLocalSearchParams<McpAddParams>()
  const scope = mcpScopeOfParams(params)
  const theme = useTheme()
  const [name, setName] = useState('')
  const [kind, setKind] = useState(EMcpTransportKind.Stdio)
  const [target, setTarget] = useState('')
  const [extra, setExtra] = useState('')
  const [proxy, setProxy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string>()
  const isStdio = kind === EMcpTransportKind.Stdio
  const personal = scope.kind === 'user'
  const draft: McpServerDraft = {
    id: personal ? serverIdOf(name) : name.trim(),
    kind,
    target,
    extra,
    proxy,
  }
  const valid = mcpDraftIsValid(draft)
  const placeholder =
    kind === EMcpTransportKind.Http ? 'https://example.com/mcp' : 'bunx tool@latest'
  const extraHint = isStdio
    ? 'One KEY=value per line. $NAME reads a secret.'
    : 'One Header: value per line. $NAME reads a secret.'

  const handleSave = () => {
    if (!valid || api === undefined || saving) return
    setSaving(true)
    setFailure(undefined)
    api.mcpServers.put
      .mutate(mcpServerPutInputOf({ scope, draft }))
      .then(() => router.back())
      .catch(() => setFailure('The server could not be saved.'))
      .finally(() => setSaving(false))
  }

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          unstable_headerRightItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button' as const,
                    label: 'Save',
                    icon: { type: 'sfSymbol' as const, name: 'checkmark' },
                    accessibilityLabel: 'Save MCP server',
                    disabled: !valid || saving,
                    onPress: handleSave,
                  },
                ]
              : undefined,
        }}
      />
      <View style={styles.section}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {personal ? 'Server' : 'Override or add'}
        </Text>
        <Card style={styles.fields}>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              {personal ? 'Name' : 'ID'}
            </Text>
            <Input
              value={name}
              onChangeText={setName}
              placeholder={personal ? 'filesystem' : 'playwright'}
              accessibilityLabel={personal ? 'Server name' : 'Server id'}
              autoCapitalize="none"
            />
            {personal && name.length > 0 ? (
              <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
                Saved as {serverIdOf(name) || '—'}
              </Text>
            ) : null}
          </View>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              Transport
            </Text>
            <ChoiceRow
              label="Transport"
              value={kind}
              options={TRANSPORTS}
              onChange={(next) => setKind(next)}
            />
          </View>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              {isStdio ? 'Command' : 'URL'}
            </Text>
            <Input
              value={target}
              onChangeText={setTarget}
              placeholder={placeholder}
              accessibilityLabel={isStdio ? 'Command' : 'URL'}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              {isStdio ? 'Environment' : 'Headers'}
            </Text>
            <Input
              value={extra}
              onChangeText={setExtra}
              placeholder={isStdio ? 'API_KEY=…' : 'Authorization: Bearer …'}
              accessibilityLabel={isStdio ? 'Environment' : 'Headers'}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              {extraHint}
            </Text>
          </View>
        </Card>
      </View>
      <Section>
        <SwitchRow
          label="Run on my Mac"
          detail="The Mac app starts this server on your Mac instead of in the sandbox."
          value={proxy}
          onValueChange={setProxy}
        />
      </Section>
      {saving ? (
        <View style={styles.saving}>
          <Spinner color={theme.primary} size={16} />
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Saving
          </Text>
        </View>
      ) : null}
      {failure === undefined ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {Platform.OS === 'ios' ? null : (
        <Button label="Save server" stretch disabled={!valid || saving} onPress={handleSave} />
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: space(2),
  },
  fields: {
    gap: space(3),
  },
  field: {
    gap: space(1.5),
  },
  saving: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
})
