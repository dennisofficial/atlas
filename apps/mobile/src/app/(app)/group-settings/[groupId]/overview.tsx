import {
  groupMemberSummaryOf,
  groupMembersOf,
  groupNameProblem,
} from '@dltech/atlas-client/settings'
import type { Project } from '@dltech/atlas-wire/web'
import { Button, Card, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import { saveGroup, useGroupsData } from '../../../../groups/use-groups'
import { EResourceState } from '../../../../settings/api-resource-state'
import { NavRow, Row, Section, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'

const projectSettingsHrefOf = ({ projectId }: { projectId: string }) =>
  `/project-settings/${encodeURIComponent(projectId)}/overview`

const GroupNameForm = ({
  groupId,
  name,
  onSaved,
}: {
  groupId: string
  name: string
  onSaved: () => void
}) => {
  const { api } = useAuth()
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const problem = groupNameProblem({ name: draft })
  const dirty = draft.trim() !== name

  const handleSave = async () => {
    if (api === undefined || problem !== null || saving) return
    setSaving(true)
    setFailure(null)
    try {
      await saveGroup({ api, groupId, name: draft.trim() })
      setSaved(true)
      onSaved()
    } catch {
      setFailure('The group could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (next: string) => {
    setDraft(next)
    setSaved(false)
  }

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Name
        </Text>
        <Input value={draft} onChangeText={handleChange} accessibilityLabel="Group name" />
      </View>
      <Button
        label="Save"
        stretch
        loading={saving}
        disabled={!dirty || problem !== null || saving}
        onPress={() => void handleSave()}
      />
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {saved ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Group saved.
        </Text>
      ) : null}
    </View>
  )
}

export default function GroupOverviewScreen() {
  const { api } = useAuth()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const { state, data, reload } = useGroupsData({ api })
  const group = data?.groups.find((item) => item.id === groupId)
  const members: Project[] =
    data === null ? [] : groupMembersOf({ projects: data.projects, groupId })
  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload]),
  )

  const handleAssign = () =>
    router.push(`/settings/group-assign?groupId=${encodeURIComponent(groupId)}`)

  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="This group could not be loaded." />
      {state === EResourceState.Ready && group === undefined ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          This group no longer exists.
        </Text>
      ) : null}
      {group === undefined ? null : (
        <>
          <Section title="Overview">
            <Card style={styles.card}>
              <GroupNameForm
                key={group.name}
                groupId={group.id}
                name={group.name}
                onSaved={reload}
              />
            </Card>
          </Section>
          <Section title="Projects">
            <Row label="Members" value={groupMemberSummaryOf(members.length)} />
            {members.map((project) => (
              <NavRow
                key={project.id}
                label={project.name}
                value={project.repo ?? 'No repository'}
                onPress={() => router.push(projectSettingsHrefOf({ projectId: project.id }))}
              />
            ))}
            <NavRow label="Assign projects" onPress={handleAssign} />
          </Section>
        </>
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: space(2),
  },
  form: {
    gap: space(2),
  },
  field: {
    gap: space(1.5),
  },
})
