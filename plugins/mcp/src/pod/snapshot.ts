import { EDefinitionOrigin } from '@dltech/atlas-core'
import { z } from 'zod'

import { EMcpRejection } from '../core'
import type { McpToolInfo } from './types'

export enum EMcpServerStatus {
  Connected = 'connected',
  Failed = 'failed',
  NeedsAuth = 'needs-auth',
  Unavailable = 'unavailable',
}

export const hashOf = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const mcpRejectionSchema = z.object({
  rejection: z.enum(EMcpRejection),
  name: z.string().optional(),
  definedIn: z.string(),
  origin: z.enum(EDefinitionOrigin),
  detail: z.string(),
})

export const mcpConfiguredTransportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).readonly().optional(),
  }),
  z.object({ kind: z.literal('http'), url: z.string().min(1) }),
])

export type McpConfiguredTransport = z.infer<typeof mcpConfiguredTransportSchema>

export const mcpConfiguredServerSchema = z.object({
  name: z.string().min(1),
  origin: z.enum(EDefinitionOrigin),
  source: z.enum(['cloud', 'repo']),
  definedIn: z.string(),
  transport: mcpConfiguredTransportSchema.nullable(),
  proxy: z.boolean(),
  configHash: z.string().min(1),
})

export type McpConfiguredServer = z.infer<typeof mcpConfiguredServerSchema>

export const mcpConfigSnapshotSchema = z.object({
  servers: z.array(mcpConfiguredServerSchema).readonly(),
  rejections: z.array(mcpRejectionSchema).readonly(),
  hash: z.string().min(1),
})

export type McpConfigSnapshot = z.infer<typeof mcpConfigSnapshotSchema>

export const mcpToolInfoSchema: z.ZodType<McpToolInfo> = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  annotations: z
    .object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional() })
    .optional(),
})

export const mcpServerToolsSchema = z.object({
  name: z.string().min(1),
  origin: z.enum(EDefinitionOrigin),
  transportKind: z.enum(['stdio', 'http']).nullable(),
  configHash: z.string().min(1),
  status: z.enum(EMcpServerStatus),
  reason: z.string().optional(),
  tools: z.array(mcpToolInfoSchema).readonly(),
  instructions: z.string().optional(),
  retry: z.boolean().optional(),
})

export type McpServerTools = z.infer<typeof mcpServerToolsSchema>

export const mcpToolsSnapshotSchema = z.object({
  configHash: z.string().min(1),
  directory: z.string().min(1),
  servers: z.array(mcpServerToolsSchema).readonly(),
})

export type McpToolsSnapshot = z.infer<typeof mcpToolsSnapshotSchema>

export const serversOf = (snapshot: McpToolsSnapshot | undefined): readonly McpServerTools[] =>
  snapshot?.servers ?? []

export const hashOfServers = (hashes: readonly string[]): string => hashOf(hashes.join('|'))
