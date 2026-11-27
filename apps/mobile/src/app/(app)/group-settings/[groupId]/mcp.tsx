import { useLocalSearchParams } from 'expo-router'

import { McpSection } from '../../../../settings/mcp/mcp-section'
import { SettingsScroll } from '../../../../settings/settings-scroll'

export default function GroupMcpScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>()

  return (
    <SettingsScroll>
      <McpSection scope={{ kind: 'group', id: groupId }} />
    </SettingsScroll>
  )
}
