import {
  addAdditionalRepository,
  additionalRepositoryProblem,
  canAddAdditionalRepository,
  editAdditionalRepository,
  removeAdditionalRepository,
  type IProjectOverviewDraft,
} from '@dltech/atlas-client/settings'
import type { Project, ProjectGroup } from '@dltech/atlas-wire/web'
import {
  Button,
  CardRow,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { assignProjectGroup } from '../groups/use-groups'
import { ChoiceRow } from '../settings/choice-row'
import { Section } from '../settings/settings-parts'

const NO_GROUP = 'none'
const GROUP_DESCRIPTION =
  'Projects in a group inherit its secrets, files, settings, skills and MCP servers.'

export const GroupChoice = ({
  project,
  groups,
  onAssigned,
}: {
  project: Project
  groups: readonly ProjectGroup[]
  onAssigned: () => void
}) => {
  const { api } = useAuth()
  const options = [
    { value: NO_GROUP, label: 'No group' },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ]

  const handleChange = async (next: string) => {
    if (api === undefined || next === (project.groupId ?? NO_GROUP)) return
    await assignProjectGroup({
      api,
      projectId: project.id,
      groupId: next === NO_GROUP ? null : next,
    })
    onAssigned()
  }

  return (
    <Section title="Group">
      <ChoiceRow
        label="Group"
        value={project.groupId ?? NO_GROUP}
        options={options}
        onChange={(next) => void handleChange(next)}
      />
      <CardRow>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.hint}>
          {GROUP_DESCRIPTION}
        </Text>
      </CardRow>
    </Section>
  )
}

export const RepositoryFields = ({
  draft,
  onDraft,
}: {
  draft: IProjectOverviewDraft
  onDraft: (next: IProjectOverviewDraft) => void
}) => {
  const repositories = draft.additionalRepositories

  const handleAdd = () =>
    onDraft({ ...draft, additionalRepositories: addAdditionalRepository(repositories) })
  const handleRemove = (index: number) =>
    onDraft({
      ...draft,
      additionalRepositories: removeAdditionalRepository({ repositories, index }),
    })
  const handleEdit = ({ index, value }: { index: number; value: string }) =>
    onDraft({
      ...draft,
      additionalRepositories: editAdditionalRepository({ repositories, index, value }),
    })

  return (
    <Section title="Additional repositories">
      {repositories.map((repository, index) => (
        <View key={`additional-${String(index)}`} style={styles.repository}>
          <Input
            value={repository}
            onChangeText={(value) => handleEdit({ index, value })}
            accessibilityLabel={`Additional repository ${String(index + 1)}`}
            placeholder="owner/name"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {additionalRepositoryProblem({ value: repository }) === null ? null : (
            <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
              Use owner/name.
            </Text>
          )}
          <Button
            label="Remove repository"
            variant={EButtonVariant.Ghost}
            size={EButtonSize.Sm}
            onPress={() => handleRemove(index)}
          />
        </View>
      ))}
      <CardRow>
        <Button
          label="Add repository"
          variant={EButtonVariant.Outline}
          size={EButtonSize.Sm}
          disabled={!canAddAdditionalRepository({ repositories })}
          onPress={handleAdd}
        />
      </CardRow>
    </Section>
  )
}

const styles = StyleSheet.create({
  hint: {
    flexShrink: 1,
  },
  repository: {
    gap: space(1.5),
  },
})
