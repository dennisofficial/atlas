import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

export const mcpArgs = z.strictObject({})

export const mcpCommand = defineCommand({
  spec: {
    name: 'mcp',
    summary: 'list this session MCP servers with their status, tool count and layer',
    group: ECommandGroup.Session,
    args: mcpArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})
