import {
  MEMORY_ALL_TYPES,
  MEMORY_PAGE_DESCRIPTION,
  MEMORY_TYPE_FILTER_OPTIONS,
  MEMORY_DELETE_TAIL,
  memoryDeleteTitleOf,
  memorySelectionOf,
  selectedMemoryNamesOf,
  memoryKeyOf,
  isMemoryTypeFilter,
  memoryClearDescriptionOf,
  memoryGroupLabel,
  memoryMatchesFilter,
  memoryScopeHintOf,
  memoryScopeOptionsOf,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '@dltech/atlas-client/settings'
import {
  Button,
  EButtonVariant,
  EButtonSize,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet } from 'react-native'

import { useReloadOnFocus } from '../../../skills/use-reload-on-focus'
import { useAuth } from '../../../auth/auth-provider'
import { ChoiceRow } from '../../../settings/choice-row'
import { confirmAction } from '../../../settings/confirm-action'
import { deleteMemoryEntry, loadMemoryGroups } from '../../../settings/memory-api'
import { MemoryRowView } from '../../../settings/memory-row'
import { ActionRow, EActionTone, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'

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
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const group = groups.find((candidate) => candidate.id === groupId) ?? groups[0]

  if (group === undefined) return null
  const visible = group.memories.filter((entry) => memoryMatchesFilter({ entry, query, type }))

  const handleSearch = (event: { nativeEvent: { text: string } }) =>
    setQuery(event.nativeEvent.text)
  const handleCancelSearch = () => setQuery('')
  const liveSelected = selectedMemoryNamesOf({ selected, memories: group.memories })
  const handleGroupChange = (id: string) => {
    setGroupId(id)
    setSelected([])
  }
  const handleToggleSelecting = () => {
    setSelecting((current) => !current)
    setSelected([])
  }
  const handleSelect = (entry: MemoryEntry) =>
    setSelected((current) =>
      memorySelectionOf({
        selectedNames: current,
        name: entry.name,
        selected: !current.includes(entry.name),
      }),
    )
  const handleDeleteSelected = () => {
    if (api === undefined || deleting || liveSelected.length === 0) return
    const names = liveSelected
    confirmAction({
      title: memoryDeleteTitleOf(names.length),
      message: MEMORY_DELETE_TAIL,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        setDeleting(true)
        setFailure(null)
        void Promise.allSettled(
          names.map((name) => deleteMemoryEntry({ api, key: memoryKeyOf({ group, name }) })),
        )
          .then((results) => {
            if (results.some((result) => result.status === 'rejected')) {
              setFailure('The selected memories could not all be deleted. Try again.')
              return
            }
            setSelected([])
            setSelecting(false)
          })
          .catch(() => setFailure('The selected memories could not all be deleted. Try again.'))
          .finally(() => {
            setDeleting(false)
            reload()
          })
      },
    })
  }
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
          unstable_headerRightItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button',
                    label: selecting ? 'Done' : 'Select',
                    icon: {
                      type: 'sfSymbol',
                      name: selecting ? 'checkmark.circle.fill' : 'checkmark.circle',
                    },
                    accessibilityLabel: selecting ? 'Done selecting memories' : 'Select memories',
                    disabled: deleting,
                    onPress: handleToggleSelecting,
                  },
                ]
              : undefined,
          headerRight:
            Platform.OS === 'ios'
              ? undefined
              : () => (
                  <Button
                    label={selecting ? 'Done' : 'Select'}
                    variant={EButtonVariant.Ghost}
                    size={EButtonSize.Sm}
                    disabled={deleting}
                    onPress={handleToggleSelecting}
                  />
                ),
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
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {selecting && liveSelected.length > 0 ? (
        <Section title={`${liveSelected.length} selected`}>
          <ActionRow
            label={memoryDeleteTitleOf(liveSelected.length)}
            tone={EActionTone.Destructive}
            loading={deleting}
            onPress={handleDeleteSelected}
          />
          <ActionRow label="Clear selection" loading={deleting} onPress={() => setSelected([])} />
        </Section>
      ) : null}
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
            <MemoryRowView
              key={entry.name}
              entry={entry}
              selecting={selecting}
              selected={liveSelected.includes(entry.name)}
              disabled={deleting}
              onPress={selecting ? handleSelect : handleOpen}
            />
          ))
        )}
      </Section>
      {selecting || group.memories.length === 0 ? null : (
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
  useReloadOnFocus(reload)

  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="Your memories could not be loaded." />
      {data === null ? null : <MemoryContent groups={data} reload={reload} />}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  hint: {
    paddingHorizontal: space(4),
    paddingVertical: space(1),
  },
})
