import { PROJECT_SECTIONS } from '@dltech/atlas-client/settings'
import { router, useLocalSearchParams } from 'expo-router'

import { NavRow, Section } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { IOS_PROJECT_SECTION_ROUTES } from '../../../../settings/settings-routes'

export default function ProjectSettingsScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()

  return (
    <SettingsScroll>
      <Section>
        {PROJECT_SECTIONS.map((item) => {
          const route = IOS_PROJECT_SECTION_ROUTES[item.section]
          if (route === undefined) return null
          return (
            <NavRow
              key={item.section}
              label={item.label}
              onPress={() => router.push(route({ id: projectId }))}
            />
          )
        })}
      </Section>
    </SettingsScroll>
  )
}
