import { CardRow, EFontFamily, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { McpScope } from '@dltech/atlas-client/settings'
import { EConfigLayer, type McpServerLayer } from '@dltech/atlas-wire/web'
import { router, Stack } from 'expo-router'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { EResourceState } from '../api-resource-state'
import { ActionRow, NavRow, Section, StatusRows } from '../settings-parts'
import { mcpAddParamsOf } from './mcp-add-scope'
import { RepoRow, ServerRow } from './mcp-rows'
import { useMcp, useMcpLayers } from './use-mcp'

const labelOf = (scope: McpScope): string => {
  if (scope.kind === 'project') return 'Project servers override your group and personal servers.'
  if (scope.kind === 'group')
    return 'Group servers reach every project in this group and override your personal servers.'
  return 'Servers saved to your account. Project and group servers override them.'
}

const addHrefOf = (scope: McpScope) => ({
  pathname: '/settings/mcp-add' as const,
  params: mcpAddParamsOf(scope),
})

const InheritedServers = ({
  layers,
  own,
}: {
  layers: readonly McpServerLayer[]
  own: EConfigLayer
}) => {
  const inherited = layers.filter((entry) => entry.layer !== own)
  if (inherited.length === 0) return null
  return (
    <Section title="Inherited">
      {inherited.flatMap((entry) => {
        const editHref =
          entry.layer === EConfigLayer.Personal
            ? '/settings/integrations'
            : entry.layer === EConfigLayer.Group && entry.owner.id !== null
              ? `/group-settings/${encodeURIComponent(entry.owner.id)}/mcp`
              : undefined
        return [
          ...entry.items.map((item) => (
            <CardRow key={`${entry.layer}:${item.name}`}>
              <View style={styles.copy}>
                <View style={styles.head}>
                  <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
                    {item.name}
                  </Text>
                  <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
                    {entry.owner.name}
                  </Text>
                  {item.overriddenBy === null ? null : (
                    <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
                      {`Replaced by ${item.overriddenBy}`}
                    </Text>
                  )}
                </View>
              </View>
            </CardRow>
          )),
          ...(editHref === undefined
            ? []
            : [
                <NavRow
                  key={`${entry.layer}:edit`}
                  label={`Edit ${entry.owner.name}`}
                  onPress={() => router.push(editHref)}
                />,
              ]),
        ]
      })}
    </Section>
  )
}

export const McpSection = ({ scope }: { scope: McpScope }) => {
  const { api } = useAuth()
  const mcp = useMcp({ api, scope })
  const own = scope.kind === 'group' ? EConfigLayer.Group : EConfigLayer.Project
  const { layers } = useMcpLayers({ api, scope })
  const handleAdd = () => router.push(addHrefOf(scope))

  return (
    <>
      <Stack.Screen
        options={{
          unstable_headerRightItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button' as const,
                    label: 'Add server',
                    icon: { type: 'sfSymbol' as const, name: 'plus' },
                    accessibilityLabel: 'Add MCP server',
                    onPress: handleAdd,
                  },
                ]
              : undefined,
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {labelOf(scope)}
      </Text>
      {mcp.notice === undefined ? null : (
        <Text size={ETextRole.Sm} tone={mcp.notice.ok ? ETextTone.Muted : ETextTone.Destructive}>
          {mcp.notice.message}
        </Text>
      )}
      {mcp.state === EResourceState.Loading ? <StatusRows state={EResourceState.Loading} /> : null}
      {mcp.state === EResourceState.Failed ? (
        <StatusRows
          state={EResourceState.Failed}
          onRetry={mcp.reload}
          failure="MCP servers could not be loaded."
        />
      ) : null}
      {mcp.state !== EResourceState.Ready ? null : mcp.rows.length === 0 ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          No MCP servers yet. Add one to give threads extra tools.
        </Text>
      ) : (
        <Section title="Servers">
          {mcp.rows.map((row) => (
            <ServerRow key={row.id} mcp={mcp} row={row} />
          ))}
        </Section>
      )}
      {mcp.repoServers.length === 0 ? null : (
        <Section title="From repo">
          {mcp.repoServers.map((server) => (
            <RepoRow key={server.id} mcp={mcp} server={server} />
          ))}
        </Section>
      )}
      {scope.kind === 'user' ? null : (
        <Section>
          <NavRow
            label="Personal MCP settings"
            onPress={() => router.push('/settings/integrations')}
          />
        </Section>
      )}
      {scope.kind === 'user' ? null : <InheritedServers layers={layers} own={own} />}
      <Section>
        <ActionRow label="Add MCP server" onPress={handleAdd} />
      </Section>
    </>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(2),
  },
})
