import type { HealthFrame } from '../frames'
import { EProtection, type ProtectionReport } from '../health'
import type { OpName } from '../ops'
import type { CallStore } from './call-store'
import type { DaemonGroup, DaemonGroupFactory, RegisteredOp } from './group'

export enum ECloseCode {
  Unauthenticated = 4001,
  Superseded = 4002,
}

export type EngineConnection = {
  send(text: string): void
  close(args: { code: ECloseCode; reason: string }): void
}

export type EngineLink = {
  receive(text: string): void
  closed(): void
}

export type DaemonEngineArgs = {
  bootId: string
  version: string
  token: string
  store: CallStore
  groups: readonly DaemonGroupFactory[]
  health(): Omit<HealthFrame, 'kind' | 'bootId' | 'version'>
  onFault(args: { key?: string | undefined; error: unknown }): void
}

export const opsOf = (groups: readonly DaemonGroup[]): ReadonlyMap<OpName, RegisteredOp> => {
  const ops = new Map<OpName, RegisteredOp>()
  for (const group of groups) {
    for (const op of group.ops) {
      if (ops.has(op.op)) throw new Error(`op ${op.op} registered twice`)
      ops.set(op.op, op)
    }
  }
  return ops
}

export const UNSUPPORTED_PROTECTION: ProtectionReport = {
  cgroups: { status: EProtection.Unsupported },
  oomScoreAdj: { status: EProtection.Unsupported },
}
