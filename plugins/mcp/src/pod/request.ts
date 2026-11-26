import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

import { asRecord, callResultOf, McpTransportError, messageOf, type McpCallResult } from './types'

export type Exit = { exitCode: number | null; signal: string | null }

export const exitReasonOf = (ended: Exit): string =>
  ended.signal === null
    ? `the server exited with code ${ended.exitCode ?? 'unknown'}`
    : `the server was killed by ${ended.signal}`

export const requestCall = async (args: {
  ctx: PluginPodContext
  serverId: string
  params: unknown
  signal: AbortSignal | undefined
  timeoutMs: number
  onExited(error: McpTransportError): void
}): Promise<McpCallResult> => {
  const result = await args.ctx.call(
    {
      op: 'mcp.request',
      serverId: args.serverId,
      method: 'tools/call',
      params: args.params,
      timeoutMs: args.timeoutMs,
    },
    args.signal === undefined ? undefined : { signal: args.signal },
  )
  if (result.status !== ECallStatus.Ok || result.op !== 'mcp.request') {
    const reason = result.status === ECallStatus.Ok ? 'the request failed' : result.error.message
    throw new McpTransportError(`could not reach the server: ${reason}`)
  }
  const value = result.value
  if (value.kind === 'timed-out') throw new McpTransportError('request timed out')
  if (value.kind === 'exited') {
    const error = new McpTransportError(exitReasonOf(value.exit), value.stderr)
    args.onExited(error)
    throw error
  }
  const response = asRecord(value.response)
  const error = response?.['error']
  if (error !== undefined)
    throw new McpTransportError(messageOf(asRecord(error)?.['message'] ?? error))
  return callResultOf(response?.['result'])
}
