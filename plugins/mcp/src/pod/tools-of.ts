import type { ToolDefinition } from '@dltech/atlas-core'

import { McpBridgeTool } from './bridge-tool'
import { connectedServersOf } from './resources'
import type { McpToolsSnapshot } from './snapshot'
import type { McpCallResult } from './types'

export type { McpToolsSnapshot } from './snapshot'

export const bridgeToolsOf = (args: {
  snapshot: McpToolsSnapshot | undefined
  call(
    server: string,
    call: { tool: string; input: unknown; signal?: AbortSignal | undefined },
  ): Promise<McpCallResult>
}): readonly ToolDefinition[] =>
  connectedServersOf(args.snapshot).flatMap((server) =>
    server.tools.map(
      (info) =>
        new McpBridgeTool({
          server: server.name,
          info,
          caller: () => ({
            name: server.name,
            call: (call) => args.call(server.name, call),
          }),
        }),
    ),
  )
