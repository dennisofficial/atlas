import { z } from 'zod'

import { EMcpViewStatus, type McpServerRow } from './row'

export enum EMcpSignInResult {
  Connected = 'connected',
  Failed = 'failed',
}

export type McpSignInStarted = {
  type: 'mcp-sign-in-started'
  server: string
  url: string
  expiresAt?: string | undefined
  sessionId: string
}

export type McpSignInResolved = {
  type: 'mcp-sign-in-resolved'
  server: string
  result: EMcpSignInResult
  sessionId: string
  reason?: string | undefined
}

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'mcp-sign-in-started': McpSignInStarted
    'mcp-sign-in-resolved': McpSignInResolved
  }
}

export const mcpSignInStartedSchema: z.ZodType<McpSignInStarted> = z.object({
  type: z.literal('mcp-sign-in-started'),
  server: z.string().min(1),
  url: z.string().min(1),
  expiresAt: z.string().optional(),
  sessionId: z.string().min(1),
})

export const mcpSignInResolvedSchema: z.ZodType<McpSignInResolved> = z.object({
  type: z.literal('mcp-sign-in-resolved'),
  server: z.string().min(1),
  result: z.enum(EMcpSignInResult),
  sessionId: z.string().min(1),
  reason: z.string().optional(),
})

export type OutstandingSignIn = { server: string; expiresAt?: string | undefined }

export const LINK_EXPIRED_REASON = 'the sign-in link expired before it was approved'

const resolutionOf = (args: {
  pending: OutstandingSignIn
  row: McpServerRow | undefined
  sessionId: string
  now: number
}): McpSignInResolved | null => {
  const { pending, row, sessionId } = args
  if (row?.status === EMcpViewStatus.Connected) {
    return {
      type: 'mcp-sign-in-resolved',
      server: pending.server,
      result: EMcpSignInResult.Connected,
      sessionId,
    }
  }
  if (row?.status === EMcpViewStatus.Failed) {
    return {
      type: 'mcp-sign-in-resolved',
      server: pending.server,
      result: EMcpSignInResult.Failed,
      sessionId,
      ...(row.reason === undefined ? {} : { reason: row.reason }),
    }
  }
  if (pending.expiresAt !== undefined && Date.parse(pending.expiresAt) <= args.now) {
    return {
      type: 'mcp-sign-in-resolved',
      server: pending.server,
      result: EMcpSignInResult.Failed,
      sessionId,
      reason: LINK_EXPIRED_REASON,
    }
  }
  return null
}

export const signInResolutionsOf = (args: {
  sessionId: string
  pending: readonly OutstandingSignIn[]
  rows: readonly McpServerRow[]
  now: number
}): { resolved: readonly McpSignInResolved[]; outstanding: readonly OutstandingSignIn[] } => {
  const resolved: McpSignInResolved[] = []
  const outstanding: OutstandingSignIn[] = []
  for (const pending of args.pending) {
    const row = args.rows.find((candidate) => candidate.name === pending.server)
    const resolution = resolutionOf({ pending, row, sessionId: args.sessionId, now: args.now })
    if (resolution === null) outstanding.push(pending)
    else resolved.push(resolution)
  }
  return { resolved, outstanding }
}
