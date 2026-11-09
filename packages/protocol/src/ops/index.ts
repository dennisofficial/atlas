import { z } from 'zod'

import { execEventSchemas, execOpSchemas, execResultSchemas } from './exec'
import { filesEventSchemas, filesOpSchemas, filesResultSchemas } from './files'
import { gitEventSchemas, gitOpSchemas, gitResultSchemas } from './git'
import { mcpEventSchemas, mcpOpSchemas, mcpResultSchemas } from './mcp'
import { previewsOpSchemas, previewsResultSchemas } from './previews'
import { failedCallResultSchema } from './result'
import { servicesEventSchemas, servicesOpSchemas, servicesResultSchemas } from './services'
import { terminalEventSchemas, terminalOpSchemas, terminalResultSchemas } from './terminal'
import { shellsEventSchemas, shellsOpSchemas, shellsResultSchemas } from './shells'

export const callOpSchema = z.discriminatedUnion('op', [
  ...execOpSchemas,
  ...filesOpSchemas,
  ...gitOpSchemas,
  ...mcpOpSchemas,
  ...previewsOpSchemas,
  ...servicesOpSchemas,
  ...terminalOpSchemas,
  ...shellsOpSchemas,
])

export const okCallResultSchema = z.discriminatedUnion('op', [
  ...execResultSchemas,
  ...filesResultSchemas,
  ...gitResultSchemas,
  ...mcpResultSchemas,
  ...previewsResultSchemas,
  ...servicesResultSchemas,
  ...terminalResultSchemas,
  ...shellsResultSchemas,
])

export const callResultSchema = z.union([okCallResultSchema, failedCallResultSchema])

export const daemonEventSchema = z.discriminatedUnion('type', [
  ...execEventSchemas,
  ...filesEventSchemas,
  ...gitEventSchemas,
  ...mcpEventSchemas,
  ...servicesEventSchemas,
  ...terminalEventSchemas,
  ...shellsEventSchemas,
])

export type CallOp = z.infer<typeof callOpSchema>
export type OpName = CallOp['op']
export type OpOf<K extends OpName> = Extract<CallOp, { op: K }>
export type OkCallResult = z.infer<typeof okCallResultSchema>
export type OpValue<K extends OpName> = Extract<OkCallResult, { op: K }>['value']
export type CallResult = z.infer<typeof callResultSchema>
export type DaemonEvent = z.infer<typeof daemonEventSchema>

export * from './exec'
export * from './files'
export * from './git'
export * from './mcp'
export * from './previews'
export * from './result'
export * from './services'
export * from './terminal'
export * from './shells'
