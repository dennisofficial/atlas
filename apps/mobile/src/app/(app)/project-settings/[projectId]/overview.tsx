import {
  identityOf,
  overviewDraftIsValid,
  overviewDraftOf,
  overviewDraftsEqual,
  overviewSaveBodyOf,
  removeAdditionalRepository,
  shipOptionsOf,
  type IProjectOverviewDraft,
} from '@dltech/atlas-client/settings'
import type { Project, ProjectGroup, ProjectUpdate } from '@dltech/atlas-wire/web'
import { Button, EFontFamily, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import { useGroupsData } from '../../../../groups/use-groups'
import { GroupChoice, RepositoryFields } from '../../../../project-settings/overview-parts'
import { EProjectLoad, useProjectSettings } from '../../../../project-settings/use-project-settings'
import { SESSIONS_HREF } from '../../../../navigation/tabs'
import { EResourceState } from '../../../../settings/api-resource-state'
import { ChoiceRow } from '../../../../settings/choice-row'
import {
  ActionRow,
  EActionTone,
  Row,
  Section,
  StatusRows,
} from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'

const confirmDelete = ({ name, onConfirm }: { name: string; onConfirm: () => void }) => {
  const message = 'Threads keep their sandboxes. This cannot be undone.'
  if (Platform.OS !== 'web') {
    Alert.alert(`Delete ${name}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete project', style: 'destructive', onPress: onConfirm },
    ])
    return
  }
  if (window.confirm(`Delete ${name}? ${message}`)) onConfirm()
}

const ProjectForm = ({
  project,
  groups,
  onSave,
  onReload,
}: {
  project: Project
  groups: readonly ProjectGroup[]
  onSave: (payload: ProjectUpdate) => Promise<void>
  onReload: () => void
}) => {
  const { api } = useAuth()
  const [draft, setDraft] = useState<IProjectOverviewDraft>(() => overviewDraftOf(project))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const identity = identityOf(project)
  const dirty = !overviewDraftsEqual({ left: draft, right: overviewDraftOf(project) })
  const invalid = !overviewDraftIsValid({ draft })

  const handleChange = (next: IProjectOverviewDraft) => {
    setDraft(next)
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setFailure(null)
    try {
      await onSave({ projectId: project.id, ...overviewSaveBodyOf({ project, draft }) })
      setSaved(true)
    } catch {
      setFailure('The project could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (api === undefined) return
    confirmDelete({
      name: project.name,
      onConfirm: () => {
        void api.projects.remove
          .mutate({ projectId: project.id })
          .then(() => router.replace(SESSIONS_HREF))
          .catch(() => setFailure('The project could not be deleted.'))
      },
    })
  }

  return (
    <>
      <View style={styles.form}>
        <View style={styles.field}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Name
          </Text>
          <Input
            value={draft.name}
            onChangeText={(name) => handleChange({ ...draft, name })}
            placeholder="Project name"
            accessibilityLabel="Project name"
          />
          {identity.owner === '' ? null : (
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} family={EFontFamily.Mono}>
              {identity.owner} /
            </Text>
          )}
        </View>
        <View style={styles.field}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Description
          </Text>
          <Input
            value={draft.description}
            onChangeText={(description) => handleChange({ ...draft, description })}
            placeholder="What this project is for"
            accessibilityLabel="Project description"
            multiline
          />
        </View>
        <View style={styles.field}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Base branch
          </Text>
          <Input
            value={draft.baseBranch}
            onChangeText={(baseBranch) => handleChange({ ...draft, baseBranch })}
            placeholder="Repository default branch"
            accessibilityLabel="Base branch"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Section title="Ship behavior">
          <ChoiceRow
            label="Ship behavior"
            value={draft.shipBehavior}
            options={shipOptionsOf(draft.shipBehavior).map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            onChange={(shipBehavior) => handleChange({ ...draft, shipBehavior })}
          />
        </Section>
        <Button
          label="Save"
          stretch
          loading={saving}
          disabled={!dirty || invalid || saving}
          onPress={() => void handleSave()}
        />
        {failure === null ? null : (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {failure}
          </Text>
        )}
        {saved && !dirty ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Project saved.
          </Text>
        ) : null}
      </View>
      <Section title="Repository">
        <Row label="GitHub repository" value={project.repo ?? 'No repository connected'} mono />
      </Section>
      <GroupChoice project={project} groups={groups} onAssigned={onReload} />
      <RepositoryFields draft={draft} onDraft={handleChange} />
      <Section title="Danger zone">
        <ActionRow label="Delete project" tone={EActionTone.Destructive} onPress={handleDelete} />
      </Section>
    </>
  )
}

const resourceStateOf = (load: EProjectLoad): EResourceState => {
  if (load === EProjectLoad.Ready) return EResourceState.Ready
  if (load === EProjectLoad.Failed) return EResourceState.Failed
  return EResourceState.Loading
}

export default function ProjectOverviewScreen() {
  const { api } = useAuth()
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const { project, load, retry, save } = useProjectSettings({ api, projectId })
  const groupsData = useGroupsData({ api })
  const groups = groupsData.data?.groups ?? []

  return (
    <SettingsScroll>
      <StatusRows
        state={resourceStateOf(load)}
        onRetry={retry}
        failure="This project could not be loaded."
      />
      {project === null ? null : (
        <ProjectForm
          key={project.id}
          project={project}
          groups={groups}
          onSave={save}
          onReload={retry}
        />
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  form: {
    gap: space(2),
  },
  field: {
    gap: space(1.5),
  },
})
