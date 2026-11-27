import {
  Button,
  Card,
  EFontWeight,
  ETextRole,
  ETextTone,
  Input,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { Project, ProjectUpdate } from '@dltech/atlas-wire/web'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import {
  draftIsDirty,
  draftIsValid,
  draftOf,
  type IProjectDraft,
  updatePayloadOf,
} from '../../../../project-settings/project-settings-draft'
import { EProjectLoad, useProjectSettings } from '../../../../project-settings/use-project-settings'
import { EResourceState } from '../../../../settings/api-resource-state'
import { Row, Section, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'

const ProjectForm = ({
  project,
  onSave,
}: {
  project: Project
  onSave: (payload: ProjectUpdate) => Promise<void>
}) => {
  const [draft, setDraft] = useState<IProjectDraft>(() => draftOf(project))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const dirty = draftIsDirty({ project, draft })
  const invalid = !draftIsValid({ draft })

  const handleName = (name: string) => {
    setDraft((current) => ({ ...current, name }))
    setSaved(false)
  }

  const handleDescription = (description: string) => {
    setDraft((current) => ({ ...current, description }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setFailure(null)
    try {
      await onSave(updatePayloadOf({ project, draft }))
      setSaved(true)
    } catch {
      setFailure('The project could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <View style={styles.section}>
        <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
          Overview
        </Text>
        <Card style={styles.fields}>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              Name
            </Text>
            <Input
              value={draft.name}
              onChangeText={handleName}
              placeholder="Project name"
              accessibilityLabel="Project name"
            />
          </View>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              Description
            </Text>
            <Input
              value={draft.description}
              onChangeText={handleDescription}
              placeholder="What this project is for"
              accessibilityLabel="Project description"
              multiline
            />
          </View>
        </Card>
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
        {saved ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Project saved.
          </Text>
        ) : null}
      </View>
      <Section title="Repository">
        <Row label="GitHub repository" value={project.repo ?? 'None'} mono />
        <Row label="Base branch" value={project.baseBranch ?? 'Repository default'} mono />
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

  return (
    <SettingsScroll>
      <StatusRows
        state={resourceStateOf(load)}
        onRetry={retry}
        failure="This project could not be loaded."
      />
      {project === null ? null : <ProjectForm key={project.id} project={project} onSave={save} />}
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
})
