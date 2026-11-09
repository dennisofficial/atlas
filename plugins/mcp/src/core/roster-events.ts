import { z } from 'zod'

import { mcpServerRowSchema, type McpServerRow } from './row'

export type McpServerChanged = { type: 'mcp-server-changed'; row: McpServerRow }

export type McpServerRemoved = { type: 'mcp-server-removed'; name: string }

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'mcp-server-changed': McpServerChanged
    'mcp-server-removed': McpServerRemoved
  }
}

export const mcpServerChangedSchema: z.ZodType<McpServerChanged> = z.object({
  type: z.literal('mcp-server-changed'),
  row: mcpServerRowSchema,
})

export const mcpServerRemovedSchema: z.ZodType<McpServerRemoved> = z.object({
  type: z.literal('mcp-server-removed'),
  name: z.string().min(1),
})
