import { prCommentEditorChanges, prCommentEditorsOf } from '@dltech/atlas-client/settings'
import { decodeSettingValue, ERepoTracking, type Project } from '@dltech/atlas-wire/web'
import { Button, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import { EResourceState } from '../../../../settings/api-resource-state'
import { Row, Section, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { useApiResource } from '../../../../settings/use-api-resource'

const TRACKING_LABELS: Record<ERepoTracking, string> = {
  [ERepoTracking.App]: 'App webhook',
  [ERepoTracking.User]: 'User webhook',
  [ERepoTracking.Polled]: 'Polled — refreshes every 60s while open',
}

const LOGIN_HINT = 'Comma-separated GitHub logins. A bot’s [bot] suffix is optional.'

type IPullRequestData = { project: Project; values: ReadonlyMap<string, unknown> }

const TrackingSection = ({ project }: { project: Project }) => {
  const repos = project.repos ?? []
  if (repos.length === 0) return null
  return (
    <Section title="Tracking">
      {repos.map((binding) => (
        <Row
          key={binding.repo}
          label={binding.branch === undefined ? binding.repo : `${binding.repo}, ${binding.branch}`}
          value={TRACKING_LABELS[binding.tracking]}
          mono
        />
      ))}
    </Section>
  )
}

const CommentEditors = ({
  values,
  onSave,
}: {
  values: ReadonlyMap<string, unknown>
  onSave: (draft: { muted: string; urgent: string }) => Promise<void>
}) => {
  const saved = prCommentEditorsOf(values)
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = draft.muted !== saved.muted || draft.urgent !== saved.urgent

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.form}>
      <Section title="Comment edits">
        <View style={styles.field}>
          <Text size={ETextRole.Sm}>Muted comment editors</Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {`Edits by these authors never reach a subscribed thread. ${LOGIN_HINT}`}
          </Text>
          <Input
            value={draft.muted}
            onChangeText={(muted) => setDraft({ ...draft, muted })}
            accessibilityLabel="Muted comment editors"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
        </View>
        <View style={styles.field}>
          <Text size={ETextRole.Sm}>Urgent comment editors</Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {`Edits by these authors wake a subscribed thread at once. ${LOGIN_HINT}`}
          </Text>
          <Input
            value={draft.urgent}
            onChangeText={(urgent) => setDraft({ ...draft, urgent })}
            accessibilityLabel="Urgent comment editors"
            placeholder="No urgent editors"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
        </View>
      </Section>
      <Button
        label="Save comment editors"
        loading={saving}
        disabled={!dirty}
        onPress={() => void handleSave()}
      />
    </View>
  )
}

export default function ProjectPullRequestsScreen() {
  const { api } = useAuth()
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const { state, data, reload } = useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve<IPullRequestData | null>(null)
        : Promise.all([
            api.projects.get.query({ projectId }),
            api.projectResources.listSettings.query({ projectId }),
          ]).then(([project, body]) => ({
            project,
            values: new Map(
              body.settings.map((setting) => [setting.key, decodeSettingValue(setting.value)]),
            ),
          })),
    deps: [api, projectId],
  })

  const handleSave = async (draft: { muted: string; urgent: string }) => {
    if (api === undefined) return
    await api.projectResources.patchSettings.mutate({
      projectId,
      values: prCommentEditorChanges({ draft }),
    })
    reload()
  }

  return (
    <SettingsScroll>
      <StatusRows
        state={state}
        onRetry={reload}
        failure="The pull request settings could not be loaded."
      />
      {state !== EResourceState.Ready || data === null ? null : (
        <>
          <TrackingSection project={data.project} />
          <CommentEditors values={data.values} onSave={handleSave} />
        </>
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
