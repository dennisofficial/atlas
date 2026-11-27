import { McpSection } from '../../../settings/mcp/mcp-section'
import { GithubSection } from '../../../settings/github/github-section'
import { SettingsScroll } from '../../../settings/settings-scroll'

export default function IntegrationsSettingsScreen() {
  return (
    <SettingsScroll>
      <GithubSection />
      <McpSection scope={{ kind: 'user' }} />
    </SettingsScroll>
  )
}
