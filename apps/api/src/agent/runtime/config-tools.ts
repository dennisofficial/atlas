import type { ToolDefinition } from '@dltech/atlas-core'

import { CloudConfigTool } from '../agent-tools/cloud-config'
import { McpEditTool } from '../agent-tools/mcp-edit'
import type { CloudConfigStore } from '../config/cloud-config-store'

export const configToolsOf = (args: {
  store: CloudConfigStore | undefined
  projectId: string | null
  userId: string
}): readonly ToolDefinition[] => {
  if (args.store === undefined) return []
  const personal = args.store.forPersonal(args.userId)
  if (args.projectId === null) return [new CloudConfigTool({ personal })]
  const projectId = args.projectId
  const project = args.store.forProject(projectId)
  return [
    new CloudConfigTool({ personal, project }),
    new McpEditTool({ client: project, projectId }),
  ]
}
