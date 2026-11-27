import { useLocalSearchParams } from 'expo-router'

import { McpSection } from '../../../../settings/mcp/mcp-section'
import { SettingsScroll } from '../../../../settings/settings-scroll'

export default function ProjectMcpScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()

  return (
    <SettingsScroll>
      <McpSection scope={{ kind: 'project', id: projectId }} />
    </SettingsScroll>
  )
}
