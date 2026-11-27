import {
  Button,
  CardRow,
  EButtonSize,
  EButtonVariant,
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { EMcpAuthState, mcpServerLabelOf, type McpRow } from '@dltech/atlas-client/settings'
import {
  EMcpOauthGrantStatus,
  EMcpTransportKind,
  type McpOauthServer,
} from '@dltech/atlas-wire/web'
import { Ellipsis } from 'lucide-react-native'
import { Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native'

import type { McpControls } from './use-mcp'

export const confirmRemove = (args: { name: string; onRemove: () => void }) => {
  const text = `Remove ${args.name}? Threads stop using it.`
  if (Platform.OS === 'web') {
    if (window.confirm(text)) args.onRemove()
    return
  }
  Alert.alert('Remove MCP server', text, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: args.onRemove },
  ])
}

const SignInControl = ({
  mcp,
  serverId,
  server,
}: {
  mcp: McpControls
  serverId: string
  server: McpOauthServer | undefined
}) => {
  const state = mcp.authStateOf(server)
  if (state === EMcpAuthState.SignedIn) {
    return (
      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
        Signed in
      </Text>
    )
  }
  const label = server?.url === undefined ? 'the server' : mcpServerLabelOf(server.url)
  return (
    <Button
      label={state === EMcpAuthState.SignInAgain ? 'Sign in again' : 'Sign in'}
      variant={
        state === EMcpAuthState.SignInAgain ? EButtonVariant.Secondary : EButtonVariant.Outline
      }
      size={EButtonSize.Sm}
      loading={mcp.busyId === serverId}
      onPress={() => mcp.signIn({ serverId, label })}
    />
  )
}

const ServerActions = ({ mcp, row }: { mcp: McpControls; row: McpRow }) => {
  const theme = useTheme()
  const signedIn = mcp.authStateOf(mcp.cloudServerOf(row.id)) === EMcpAuthState.SignedIn
  const handlePress = () => {
    if (Platform.OS === 'web') {
      confirmRemove({
        name: row.id,
        onRemove: () => void mcp.remove(row.id).catch(() => undefined),
      })
      return
    }
    Alert.alert(row.id, row.target, [
      ...(signedIn
        ? [{ text: 'Sign out', onPress: () => void mcp.signOut(row.id).catch(() => undefined) }]
        : []),
      {
        text: 'Remove',
        style: 'destructive' as const,
        onPress: () => confirmRemove({ name: row.id, onRemove: () => void mcp.remove(row.id) }),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Actions for ${row.id}`}
      hitSlop={8}
      onPress={handlePress}
    >
      <Icon icon={Ellipsis} color={theme.mutedForeground} size={18} />
    </Pressable>
  )
}

export const ServerRow = ({ mcp, row }: { mcp: McpControls; row: McpRow }) => (
  <CardRow>
    <View style={styles.copy}>
      <View style={styles.head}>
        <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
          {row.id}
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {row.kind === EMcpTransportKind.Http ? 'http' : 'stdio'}
        </Text>
        {row.proxy === true ? (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            Mac
          </Text>
        ) : null}
      </View>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1} family={EFontFamily.Mono}>
        {row.target}
      </Text>
      <View style={styles.oauth}>
        <SignInControl
          mcp={mcp}
          serverId={row.id}
          server={row.enabled ? mcp.cloudServerOf(row.id) : undefined}
        />
      </View>
    </View>
    <View style={styles.trailing}>
      <Switch
        accessibilityLabel={`Enable ${row.id}`}
        value={row.enabled}
        onValueChange={(enabled) => void mcp.toggle({ id: row.id, enabled }).catch(() => undefined)}
      />
      <ServerActions mcp={mcp} row={row} />
    </View>
  </CardRow>
)

export const RepoRow = ({ mcp, server }: { mcp: McpControls; server: McpOauthServer }) => {
  const lastUsed = mcp.lastUsedOf(server)
  const handleRemove = () =>
    confirmRemove({
      name: server.name,
      onRemove: () => void mcp.forget(server.id).catch(() => undefined),
    })
  return (
    <CardRow>
      <View style={styles.copy}>
        <View style={styles.head}>
          <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
            {server.name}
          </Text>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            From repo
          </Text>
        </View>
        <Text
          size={ETextRole.Xs}
          tone={ETextTone.Muted}
          numberOfLines={1}
          family={EFontFamily.Mono}
        >
          {server.url}
        </Text>
        {lastUsed === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            Last used {lastUsed}
          </Text>
        )}
        <View style={styles.oauth}>
          <SignInControl mcp={mcp} serverId={server.name} server={server} />
        </View>
      </View>
      <View style={styles.trailing}>
        {server.status === EMcpOauthGrantStatus.Connected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sign out of ${server.name}`}
            onPress={() => void mcp.signOut(server.id).catch(() => undefined)}
          >
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              Sign out
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${server.name}`}
          onPress={handleRemove}
        >
          <Text size={ETextRole.Xs} tone={ETextTone.Destructive}>
            Remove
          </Text>
        </Pressable>
      </View>
    </CardRow>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexGrow: 1,
    flexShrink: 1,
    gap: space(1),
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(2),
  },
  oauth: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
})
