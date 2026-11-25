import { McpPage } from '../project-settings/mcp-page'
import { InheritedLayersPreview, PERSONAL_MCP_LAYER } from './inherited-layers-preview'

export function GroupMcpPage() {
  return (
    <>
      <InheritedLayersPreview layers={[PERSONAL_MCP_LAYER]} />
      <McpPage />
    </>
  )
}
