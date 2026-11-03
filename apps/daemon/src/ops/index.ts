import { execOps } from './exec'
import { filesOps } from './files'
import type { OpRegistry } from './registry'

export const daemonOps: OpRegistry = {
  ...execOps,
  ...filesOps,
}

export type { OpHandler, OpRegistry } from './registry'
