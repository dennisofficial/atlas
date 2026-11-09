import { EDefinitionOrigin } from '@dltech/atlas-core'
import { z } from 'zod'

export enum EMcpViewStatus {
  Connected = 'connected',
  Failed = 'failed',
  Disabled = 'disabled',
  NeedsAuth = 'needs-auth',
}

export const mcpTransportKindSchema = z.enum(['stdio', 'http'])

export const mcpServerRowSchema = z.object({
  name: z.string().min(1),
  transport: mcpTransportKindSchema.nullable(),
  status: z.enum(EMcpViewStatus),
  toolCount: z.number().int().min(0),
  reason: z.string().optional(),
  layer: z.enum(EDefinitionOrigin),
})

export type McpServerRow = z.infer<typeof mcpServerRowSchema>

export const mcpServerRowsSchema = z.array(mcpServerRowSchema).readonly()

export const sameMcpRow = (left: McpServerRow, right: McpServerRow): boolean =>
  JSON.stringify(left) === JSON.stringify(right)
