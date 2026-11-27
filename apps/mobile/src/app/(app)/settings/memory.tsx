import {
  MEMORY_ALL_TYPES,
  MEMORY_PAGE_DESCRIPTION,
  MEMORY_TYPE_FILTER_OPTIONS,
  MEMORY_TYPE_LABELS,
  formatMemoryDate,
  isMemoryTypeFilter,
  memoryClearDescriptionOf,
  memoryGroupLabel,
  memoryMatchesFilter,
  memoryScopeHintOf,
  memoryScopeOptionsOf,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '@dltech/atlas-client/settings'
import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useFocusEffect } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { EResourceState } from '../../../settings/api-resource-state'
import { ChoiceRow } from '../../../settings/choice-row'
import { confirmAction } from '../../../settings/confirm-action'
import { deleteMemoryEntry, loadMemoryGroups } from '../../../settings/memory-api'
import { ActionRow, EActionTone, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'

const MemoryRowView = ({
  entry,
  onPress,
}: {
  entry: MemoryEntry
  onPress: (entry: MemoryEntry) => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.name}
      onPress={() => onPress(entry)}
    >
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {MEMORY_TYPE_LABELS[entry.type]}
          </Text>
          <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
            {entry.name}
          </Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={2}>
            {entry.description}
          </Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {`rev ${entry.revision} · updated ${formatMemoryDate(entry.updatedAt)}`}
          </Text>
        </View>
        <Icon icon={ChevronRight} color={theme.mutedForeground} size={16} />
      </View>
    </Pressable>
  )
}

const MemoryContent = ({
  groups,
  reload,
}: {
  groups: readonly MemoryScopeGroup[]
  reload: () => void
}) => {
  const { api } = useAuth()
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<string>(MEMORY_ALL_TYPES)
  const group = groups.find((candidate) => candidate.id === groupId) ?? groups[0]

  if (group === undefined) return null
  const visible = group.memories.filter((entry) => memoryMatchesFilter({ entry, query, type }))

  const handleSearch = (event: { nativeEvent: { text: string } }) =>
    setQuery(event.nativeEvent.text)
  const handleCancelSearch = () => setQuery('')
  const handleGroupChange = (id: string) => setGroupId(id)
  const handleTypeChange = (next: string) => {
    if (isMemoryTypeFilter(next)) setType(next)
  }
  const handleOpen = (entry: MemoryEntry) =>
    router.push({
      pathname: '/settings/memory-entry',
      params: {
        mode: 'view',
        scope: group.scope,
        name: entry.name,
        project: group.project ?? '',
        groupId: group.groupId ?? '',
      },
    })
  const handleClear = () => {
    confirmAction({
      title: `Clear ${memoryGroupLabel(group)}?`,
      message: `${memoryClearDescriptionOf(group)} This cannot be undone.`,
      confirmLabel: 'Clear scope',
      destructive: true,
      onConfirm: () => {
        if (api === undefined) return
        const { scope, project, groupId: scopeGroupId } = group
        void Promise.all(
          group.memories.map((entry) =>
            deleteMemoryEntry({
              api,
              key: { scope, project, groupId: scopeGroupId, name: entry.name },
            }),
          ),
        ).then(reload, reload)
      },
    })
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placement: 'integratedButton',
            placeholder: 'Search memories',
            onChangeText: handleSearch,
            onCancelButtonPress: handleCancelSearch,
          },
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {MEMORY_PAGE_DESCRIPTION}
      </Text>
      <Section title="Scope">
        <ChoiceRow
          label="Scope"
          value={group.id}
          options={memoryScopeOptionsOf(groups)}
          onChange={handleGroupChange}
        />
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.hint}>
          {memoryScopeHintOf(group)}
        </Text>
      </Section>
      <Section title="Memories">
        <ChoiceRow
          label="Type"
          value={type}
          options={MEMORY_TYPE_FILTER_OPTIONS}
          onChange={handleTypeChange}
        />
        {visible.length === 0 ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.hint}>
            {group.memories.length === 0
              ? 'No memories in this scope yet. The agent writes one when it learns something worth keeping.'
              : 'No memories match. Try a different search or clear the type filter.'}
          </Text>
        ) : (
          visible.map((entry) => (
            <MemoryRowView key={entry.name} entry={entry} onPress={handleOpen} />
          ))
        )}
      </Section>
      {group.memories.length === 0 ? null : (
        <Section>
          <ActionRow
            label="Clear this scope"
            tone={EActionTone.Destructive}
            onPress={handleClear}
          />
        </Section>
      )}
    </>
  )
}

export default function MemoryScreen() {
  const { api } = useAuth()
  const { state, data, reload } = useApiResource({
    load: () => (api === undefined ? Promise.resolve(null) : loadMemoryGroups({ api })),
    deps: [api],
  })
  useFocusEffect(
    useCallback(() => {
      if (state === EResourceState.Ready) reload()
    }, [reload, state]),
  )

  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="Your memories could not be loaded." />
      {data === null ? null : <MemoryContent groups={data} reload={reload} />}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  rowText: {
    flexShrink: 1,
    gap: space(1),
  },
  hint: {
    paddingHorizontal: space(4),
    paddingVertical: space(1),
  },
})
