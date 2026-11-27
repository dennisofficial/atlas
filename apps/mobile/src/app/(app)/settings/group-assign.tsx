import type { Project } from '@dltech/atlas-wire/web'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import { useAuth } from '../../../auth/auth-provider'
import { assignProjectGroup, useGroupsData } from '../../../groups/use-groups'
import { NavRow, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'

const membershipLabelOf = ({
  project,
  groupId,
  nameOf,
}: {
  project: Project
  groupId: string
  nameOf: (id: string) => string
}): string => {
  if (project.groupId === groupId) return 'In this group'
  if (project.groupId === null) return 'No group'
  return nameOf(project.groupId)
}

export default function GroupAssignScreen() {
  const { api } = useAuth()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const { state, data, reload } = useGroupsData({ api })
  const [failure, setFailure] = useState<string | null>(null)
  const group = data?.groups.find((item) => item.id === groupId)
  const projects = data?.projects ?? []
  const nameOf = (id: string) => data?.groups.find((item) => item.id === id)?.name ?? id

  const handleToggle = async (project: Project) => {
    if (api === undefined) return
    setFailure(null)
    try {
      await assignProjectGroup({
        api,
        projectId: project.id,
        groupId: project.groupId === groupId ? null : groupId,
      })
    } catch {
      setFailure('That project could not be moved.')
    }
    reload()
  }

  const handleClose = () => router.back()

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          title: group === undefined ? 'Assign projects' : `Projects in ${group.name}`,
          headerLeft: () => (
            <Button
              label="Done"
              variant={EButtonVariant.Ghost}
              size={EButtonSize.Sm}
              onPress={handleClose}
            />
          ),
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        Tap a project to move it into this group, or out of it. A project belongs to one group.
      </Text>
      <StatusRows state={state} onRetry={reload} failure="Projects could not be loaded." />
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      <Section>
        {projects.map((project) => (
          <NavRow
            key={project.id}
            label={project.name}
            value={membershipLabelOf({ project, groupId, nameOf })}
            onPress={() => void handleToggle(project)}
          />
        ))}
      </Section>
    </SettingsScroll>
  )
}
