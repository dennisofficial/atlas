import {
  EProjectSettingsSection,
  groupMemberSummaryOf,
  groupMembersOf,
  GROUP_DELETE_DESCRIPTION,
  GROUP_DESCRIPTION,
} from '@dltech/atlas-client/settings'
import type { ProjectGroup } from '@dltech/atlas-wire/web'
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
import type { NativeStackHeaderItem } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { assignProjectGroup, removeGroup, useGroupsData } from '../../../groups/use-groups'
import { EResourceState } from '../../../settings/api-resource-state'
import {
  ActionRow,
  EActionTone,
  NavRow,
  Row,
  Section,
  StatusRows,
} from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { IOS_GROUP_SECTION_ROUTES } from '../../../settings/settings-routes'

const confirmDelete = ({ name, onConfirm }: { name: string; onConfirm: () => void }) => {
  const message = GROUP_DELETE_DESCRIPTION
  if (Platform.OS !== 'web') {
    Alert.alert(`Delete ${name}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete group', style: 'destructive', onPress: onConfirm },
    ])
    return
  }
  if (window.confirm(`Delete ${name}? ${message}`)) onConfirm()
}

const overviewHrefOf = ({ groupId }: { groupId: string }) => {
  const route = IOS_GROUP_SECTION_ROUTES[EProjectSettingsSection.Overview]
  return route === undefined ? null : route({ id: groupId })
}

const MemberRow = ({ name, onRemove }: { name: string; onRemove: () => void }) => (
  <CardRow>
    <Text size={ETextRole.Sm} numberOfLines={1} style={styles.memberName}>
      {name}
    </Text>
    <Button
      label="Remove"
      variant={EButtonVariant.Ghost}
      size={EButtonSize.Sm}
      onPress={onRemove}
    />
  </CardRow>
)

export default function GroupsScreen() {
  const { api } = useAuth()
  const { state, data, reload } = useGroupsData({ api })
  const [failure, setFailure] = useState<string | null>(null)
  const groups = data?.groups ?? []
  const projects = data?.projects ?? []

  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload]),
  )

  const handleCreate = () => router.push('/settings/group-form')
  const handleRename = (group: ProjectGroup) =>
    router.push(
      `/settings/group-form?groupId=${encodeURIComponent(group.id)}&name=${encodeURIComponent(group.name)}`,
    )
  const handleAssign = (group: ProjectGroup) =>
    router.push(`/settings/group-assign?groupId=${encodeURIComponent(group.id)}`)
  const handleOpen = (group: ProjectGroup) => {
    const href = overviewHrefOf({ groupId: group.id })
    if (href !== null) router.push(href)
  }

  const handleRemoveMember = async ({
    groupId,
    projectId,
  }: {
    groupId: string
    projectId: string
  }) => {
    if (api === undefined) return
    setFailure(null)
    try {
      await assignProjectGroup({ api, projectId, groupId: null })
    } catch {
      setFailure('That project could not be removed.')
    }
    reload()
  }

  const handleDelete = (group: ProjectGroup) => {
    if (api === undefined) return
    confirmDelete({
      name: group.name,
      onConfirm: () => {
        void removeGroup({ api, groupId: group.id })
          .catch(() => setFailure('That group could not be deleted.'))
          .finally(reload)
      },
    })
  }

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          unstable_headerRightItems: (): NativeStackHeaderItem[] => [
            {
              type: 'button',
              label: 'New group',
              icon: { type: 'sfSymbol', name: 'plus' },
              accessibilityLabel: 'New group',
              onPress: handleCreate,
            },
          ],
          headerRight:
            Platform.OS === 'ios'
              ? undefined
              : () => <Button label="New group" size={EButtonSize.Sm} onPress={handleCreate} />,
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {GROUP_DESCRIPTION}
      </Text>
      <StatusRows state={state} onRetry={reload} failure="Groups could not be loaded." />
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {state !== EResourceState.Ready ? null : groups.length === 0 ? (
        <Section title="Groups">
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.emptyText}>
              No groups yet. Group projects that share a stack, then set a secret, skill or MCP
              server once for all of them.
            </Text>
          </CardRow>
          <CardRow>
            <Button
              label="New group"
              variant={EButtonVariant.Outline}
              size={EButtonSize.Sm}
              onPress={handleCreate}
            />
          </CardRow>
        </Section>
      ) : (
        groups.map((group) => {
          const members = groupMembersOf({ projects, groupId: group.id })
          return (
            <View key={group.id} style={styles.group}>
              <Section title={group.name}>
                <Row label="Projects" value={groupMemberSummaryOf(members.length)} />
                <NavRow label="Open settings" onPress={() => handleOpen(group)} />
                {members.map((project) => (
                  <MemberRow
                    key={project.id}
                    name={project.name}
                    onRemove={() =>
                      void handleRemoveMember({ groupId: group.id, projectId: project.id })
                    }
                  />
                ))}
                <NavRow label="Assign projects" onPress={() => handleAssign(group)} />
              </Section>
              <Section>
                <NavRow label="Rename" onPress={() => handleRename(group)} />
                <ActionRow
                  label="Delete group"
                  tone={EActionTone.Destructive}
                  onPress={() => handleDelete(group)}
                />
              </Section>
            </View>
          )
        })
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  group: {
    gap: space(4),
  },
  memberName: {
    flexShrink: 1,
  },
  emptyText: {
    flexShrink: 1,
  },
})
