import type { ToolDefinition } from '@dltech/atlas-core'

import { CloudConfigTool } from '../agent-tools/cloud-config'
import { McpEditTool } from '../agent-tools/mcp-edit'
import type { CloudConfigStore } from '../config/cloud-config-store'

export const configToolsOf = (args: {
  store: CloudConfigStore | undefined
  projectId: string
}): readonly ToolDefinition[] => {
  if (args.store === undefined) return []
  const client = args.store.for(args.projectId)
  const access = { client, projectId: args.projectId }
  return [new CloudConfigTool(access), new McpEditTool(access)]
}
