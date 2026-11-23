import { z } from 'zod'

import { changesOpSchemas, changesResultSchemas } from './changes'
import { execEventSchemas, execOpSchemas, execResultSchemas } from './exec'
import { filesEventSchemas, filesOpSchemas, filesResultSchemas } from './files'
import { gitEventSchemas, gitOpSchemas, gitResultSchemas } from './git'
import { mcpEventSchemas, mcpOpSchemas, mcpResultSchemas } from './mcp'
import { metricsEventSchemas, metricsOpSchemas, metricsResultSchemas } from './metrics'
import { oomEventSchemas, oomOpSchemas, oomResultSchemas } from './oom'
import { previewsOpSchemas, previewsResultSchemas } from './previews'
import { failedCallResultSchema } from './result'
import { servicesEventSchemas, servicesOpSchemas, servicesResultSchemas } from './services'
import { terminalEventSchemas, terminalOpSchemas, terminalResultSchemas } from './terminal'
import { shellsEventSchemas, shellsOpSchemas, shellsResultSchemas } from './shells'
import { watchEventSchemas, watchOpSchemas, watchResultSchemas } from './watch'

export const callOpSchema = z.discriminatedUnion('op', [
  ...changesOpSchemas,
  ...execOpSchemas,
  ...filesOpSchemas,
  ...gitOpSchemas,
  ...mcpOpSchemas,
  ...metricsOpSchemas,
  ...oomOpSchemas,
  ...previewsOpSchemas,
  ...servicesOpSchemas,
  ...terminalOpSchemas,
  ...shellsOpSchemas,
  ...watchOpSchemas,
])

export const okCallResultSchema = z.discriminatedUnion('op', [
  ...changesResultSchemas,
  ...execResultSchemas,
  ...filesResultSchemas,
  ...gitResultSchemas,
  ...mcpResultSchemas,
  ...metricsResultSchemas,
  ...oomResultSchemas,
  ...previewsResultSchemas,
  ...servicesResultSchemas,
  ...terminalResultSchemas,
  ...shellsResultSchemas,
  ...watchResultSchemas,
])

export const callResultSchema = z.union([okCallResultSchema, failedCallResultSchema])

export const daemonEventSchema = z.discriminatedUnion('type', [
  ...execEventSchemas,
  ...filesEventSchemas,
  ...gitEventSchemas,
  ...mcpEventSchemas,
  ...metricsEventSchemas,
  ...oomEventSchemas,
  ...servicesEventSchemas,
  ...terminalEventSchemas,
  ...shellsEventSchemas,
  ...watchEventSchemas,
])

export type CallOp = z.infer<typeof callOpSchema>
export type OpName = CallOp['op']
export type OpOf<K extends OpName> = Extract<CallOp, { op: K }>
export type OkCallResult = z.infer<typeof okCallResultSchema>
export type OpValue<K extends OpName> = Extract<OkCallResult, { op: K }>['value']
export type CallResult = z.infer<typeof callResultSchema>
export type DaemonEvent = z.infer<typeof daemonEventSchema>

export * from './changes'
export * from './exec'
export * from './files'
export * from './git'
export * from './mcp'
export * from './metrics'
export * from './oom'
export * from './previews'
export * from './result'
export * from './services'
export * from './terminal'
export * from './shells'
export * from './watch'
