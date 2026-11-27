import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { router, useLocalSearchParams } from 'expo-router'

import { useAuth } from '../../../../auth/auth-provider'
import { EResourceState } from '../../../../settings/api-resource-state'
import { NavRow, Row, Section, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { IOS_GROUP_SECTION_ROUTES, routedGroupSections } from '../../../../settings/settings-routes'
import { useApiResource } from '../../../../settings/use-api-resource'

export default function GroupSettingsScreen() {
  const { api } = useAuth()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const {
    state,
    data: group,
    reload,
  } = useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve(null)
        : Promise.all([api.projectGroups.list.query(), api.projects.list.query()]).then(
            ([{ groups }, projects]) => {
              const found = groups.find((item) => item.id === groupId)
              if (found === undefined) return null
              const nameOf = new Map(projects.map((project) => [project.id, project.name]))
              return {
                name: found.name,
                projects: found.projectIds.map((id) => ({ id, name: nameOf.get(id) ?? id })),
              }
            },
          ),
    deps: [api, groupId],
  })
  const sections = routedGroupSections()

  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="This group could not be loaded." />
      {state === EResourceState.Ready && group === null ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          This group no longer exists.
        </Text>
      ) : null}
      {group === null ? null : (
        <>
          <Section title="Group">
            <Row label="Name" value={group.name} />
          </Section>
          {group.projects.length === 0 ? null : (
            <Section title="Projects">
              {group.projects.map((project) => (
                <NavRow
                  key={project.id}
                  label={project.name}
                  onPress={() => router.push(`/project-settings/${encodeURIComponent(project.id)}`)}
                />
              ))}
            </Section>
          )}
          {sections.length === 0 ? null : (
            <Section>
              {sections.map((item) => {
                const route = IOS_GROUP_SECTION_ROUTES[item.section]
                if (route === undefined) return null
                return (
                  <NavRow
                    key={item.section}
                    label={item.label}
                    onPress={() => router.push(route({ id: groupId }))}
                  />
                )
              })}
            </Section>
          )}
        </>
      )}
    </SettingsScroll>
  )
}
