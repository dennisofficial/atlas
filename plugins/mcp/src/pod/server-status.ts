import type { EDefinitionOrigin } from '@dltech/atlas-core'

import { EMcpViewStatus } from '../core'
import { McpTransportError, messageOf } from './types'

export enum EMcpServerStatus {
  Connected = 'connected',
  Failed = 'failed',
  NeedsAuth = 'needs-auth',
  Unavailable = 'unavailable',
}

export type McpServerState = {
  name: string
  origin: EDefinitionOrigin
  transport: 'stdio' | 'http' | null
  status: EMcpServerStatus
  tools: number
  reason: string | undefined
}

export const reasonOf = (error: unknown): string => {
  if (error instanceof McpTransportError) return [error.message, ...error.stderr].join('\n').trim()
  return messageOf(error)
}

export const viewStatusOf = (status: EMcpServerStatus): EMcpViewStatus => {
  if (status === EMcpServerStatus.Connected) return EMcpViewStatus.Connected
  if (status === EMcpServerStatus.NeedsAuth) return EMcpViewStatus.NeedsAuth
  if (status === EMcpServerStatus.Unavailable) return EMcpViewStatus.Unavailable
  return EMcpViewStatus.Failed
}
