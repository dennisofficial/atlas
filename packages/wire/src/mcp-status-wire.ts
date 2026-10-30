import { z } from 'zod'

export enum EMcpServerWireStatus {
  Connected = 'connected',
  NeedsAuth = 'needs-auth',
  Failed = 'failed',
  Disabled = 'disabled',
}

export const listMcpServersParamsSchema = z.object({
  refresh: z.boolean().optional(),
})
export type ListMcpServersParams = z.infer<typeof listMcpServersParamsSchema>

export const mcpServerStatusWireSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'none']),
  url: z.string().optional(),
  status: z.enum(EMcpServerWireStatus),
  toolCount: z.number().int().nonnegative(),
  reason: z.string().optional(),
})
export type McpServerStatusWire = z.infer<typeof mcpServerStatusWireSchema>

export const listMcpServersReplySchema = z.object({
  servers: z.array(mcpServerStatusWireSchema),
})
export type ListMcpServersReply = z.infer<typeof listMcpServersReplySchema>
