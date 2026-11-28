import {
  liveSelectedOf,
  SKILL_PRECEDENCE_COPY,
  skillsDescriptionOf,
  type SkillScopeTarget,
  visibleSkillsOf,
} from '@dltech/atlas-client/settings'
import {
  Button,
  Card,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  ETextTone,
  Input,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { NativeStackHeaderItem } from 'expo-router'
import { router, Stack } from 'expo-router'
import { useCallback, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { EResourceState } from '../settings/api-resource-state'
import { ChoiceRow } from '../settings/choice-row'
import { ActionRow, EActionTone, Section, StatusRows } from '../settings/settings-parts'
import { SettingsScroll } from '../settings/settings-scroll'
import { confirmDelete } from './confirm-delete'
import { InheritedSkills } from './inherited-skills'
import { SkillRow } from './skill-row'
import { newSkillRouteOf, skillDetailRouteOf } from './skill-routes'
import {
  deleteConfirmCopyOf,
  deleteConfirmTitleOf,
  ESkillSortChoice,
  ownSkillLayerOf,
  SKILL_SORT_OPTIONS,
  sortOfChoice,
  toggleSelected,
} from './skills-list-state'
import { useReloadOnFocus } from './use-reload-on-focus'
import { useSkillLayers, useSkills } from './use-skills'

const EmptyCard = ({ title, description }: { title: string; description: string }) => (
  <Card style={styles.empty}>
    <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
      {title}
    </Text>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
      {description}
    </Text>
  </Card>
)

export const SkillsScreen = ({ target }: { target: SkillScopeTarget }) => {
  const { api } = useAuth()
  const layers = useSkillLayers({ api, target })
  const { skills, state, reload, remove } = useSkills({
    api,
    target,
    onMutated: layers.reload,
  })
  const [query, setQuery] = useState('')
  const [choice, setChoice] = useState<ESkillSortChoice>(ESkillSortChoice.Default)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const handleRefresh = useCallback(() => {
    reload()
    layers.reload()
  }, [reload, layers.reload])

  useReloadOnFocus(handleRefresh)

  const visible = visibleSkillsOf({ skills, query, sort: sortOfChoice(choice) })
  const liveSelected = liveSelectedOf({ selected, visible })
  const ownLayer = ownSkillLayerOf(target)

  const handleSearch = (event: { nativeEvent: { text: string } }) =>
    setQuery(event.nativeEvent.text)
  const handleCancelSearch = () => setQuery('')
  const handleToggleSelecting = () => {
    setSelecting((current) => !current)
    setSelected([])
  }
  const handleSelect = (name: string) =>
    setSelected((current) => toggleSelected({ selected: current, name }))
  const handleClearSelection = () => setSelected([])
  const handleNewSkill = () => router.push(newSkillRouteOf(target))
  const handleDelete = () => {
    const names = liveSelected
    if (names.length === 0) return
    confirmDelete({
      title: deleteConfirmTitleOf({ count: names.length }),
      message: deleteConfirmCopyOf({ names }),
      onConfirm: () => {
        setDeleting(true)
        setFailure(null)
        remove({ names })
          .then(() => {
            setSelected([])
            setSelecting(false)
          })
          .catch(() => setFailure('The skills could not be deleted.'))
          .finally(() => setDeleting(false))
      },
    })
  }

  const headerItems = (): NativeStackHeaderItem[] =>
    selecting
      ? [
          {
            type: 'button',
            label: 'Done',
            icon: { type: 'sfSymbol', name: 'checkmark.circle.fill' },
            accessibilityLabel: 'Done selecting skills',
            onPress: handleToggleSelecting,
          },
        ]
      : [
          {
            type: 'button',
            label: 'Select',
            icon: { type: 'sfSymbol', name: 'checkmark.circle' },
            accessibilityLabel: 'Select skills',
            onPress: handleToggleSelecting,
          },
          {
            type: 'button',
            label: 'New skill',
            icon: { type: 'sfSymbol', name: 'plus' },
            accessibilityLabel: 'New skill',
            onPress: handleNewSkill,
          },
        ]

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placement: 'integratedButton',
            placeholder: 'Search skills',
            onChangeText: handleSearch,
            onCancelButtonPress: handleCancelSearch,
          },
          unstable_headerRightItems: Platform.OS === 'ios' ? headerItems : undefined,
          headerRight:
            Platform.OS === 'ios'
              ? undefined
              : () => (
                  <View style={styles.headerButtons}>
                    <Button
                      label={selecting ? 'Done' : 'Select'}
                      variant={EButtonVariant.Ghost}
                      size={EButtonSize.Sm}
                      onPress={handleToggleSelecting}
                    />
                    <Button
                      label="New skill"
                      variant={EButtonVariant.Ghost}
                      size={EButtonSize.Sm}
                      onPress={handleNewSkill}
                    />
                  </View>
                ),
        }}
      />
      <View style={styles.intro}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {skillsDescriptionOf(target)}
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {SKILL_PRECEDENCE_COPY}
        </Text>
        {Platform.OS === 'ios' ? null : (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search skills…"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search skills"
          />
        )}
      </View>
      <StatusRows state={state} onRetry={reload} failure="Skills could not be loaded." />
      {selecting && liveSelected.length > 0 ? (
        <Section title={`${liveSelected.length} selected`}>
          <ActionRow
            label={deleteConfirmTitleOf({ count: liveSelected.length })}
            tone={EActionTone.Destructive}
            loading={deleting}
            onPress={handleDelete}
          />
          <ActionRow label="Clear selection" onPress={handleClearSelection} />
        </Section>
      ) : null}
      {skills.length > 0 ? (
        <Section title="Sort">
          <ChoiceRow
            label="Order"
            value={choice}
            options={SKILL_SORT_OPTIONS}
            onChange={setChoice}
          />
        </Section>
      ) : null}
      {state === EResourceState.Ready && skills.length === 0 ? (
        <EmptyCard
          title="No skills here yet"
          description="Create one with the New skill button — it starts as an empty SKILL.md."
        />
      ) : null}
      {state === EResourceState.Ready && skills.length > 0 && visible.length === 0 ? (
        <EmptyCard title="No skills match." description="Try a different search." />
      ) : null}
      {visible.length > 0 ? (
        <Section>
          {visible.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              selecting={selecting}
              selected={liveSelected.includes(skill.name)}
              onSelect={() => handleSelect(skill.name)}
              onOpen={() => router.push(skillDetailRouteOf({ target, skill: skill.name }))}
            />
          ))}
        </Section>
      ) : null}
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {ownLayer === null ? null : (
        <>
          <StatusRows
            state={layers.state}
            onRetry={layers.reload}
            failure="Inherited skills could not be loaded."
          />
          {layers.state === EResourceState.Ready ? (
            <InheritedSkills layers={layers.layers} ownLayer={ownLayer} />
          ) : null}
        </>
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  intro: {
    gap: space(2),
  },
  empty: {
    gap: space(1.5),
  },
  headerButtons: {
    flexDirection: 'row',
    gap: space(1),
  },
})
