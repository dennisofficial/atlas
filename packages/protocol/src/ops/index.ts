import { z } from 'zod'

import { execEventSchemas, execOpSchemas, execResultSchemas } from './exec'
import { filesEventSchemas, filesOpSchemas, filesResultSchemas } from './files'
import { failedCallResultSchema } from './result'
import { terminalEventSchemas, terminalOpSchemas, terminalResultSchemas } from './terminal'

export const callOpSchema = z.discriminatedUnion('op', [
  ...execOpSchemas,
  ...filesOpSchemas,
  ...terminalOpSchemas,
])

export const okCallResultSchema = z.discriminatedUnion('op', [
  ...execResultSchemas,
  ...filesResultSchemas,
  ...terminalResultSchemas,
])

export const callResultSchema = z.union([okCallResultSchema, failedCallResultSchema])

export const daemonEventSchema = z.discriminatedUnion('type', [
  ...execEventSchemas,
  ...filesEventSchemas,
  ...terminalEventSchemas,
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
export * from './result'
export * from './terminal'
