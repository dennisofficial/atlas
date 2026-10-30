import {
  EDeclaredServiceState,
  EKilledBy,
  EServiceStatus,
  mayStillBeAlive,
  type DeclaredServicesView,
  type DeclaredServiceView,
} from '@dltech/atlas-core'
import type { ServiceSnapshot } from '@dltech/atlas-harness'

import { formatElapsed } from './theme'

export type ServicesState = { index: number }

export const isServiceRunning = (service: { status: EServiceStatus }): boolean =>
  service.status === EServiceStatus.Running

export type ServiceRow = {
  key: string
  name: string
  declared?: DeclaredServiceView | undefined
  snapshot?: ServiceSnapshot | undefined
}

export enum EServiceTone {
  Ok = 'ok',
  Idle = 'idle',
  Attention = 'attention',
}

const declaredKey = (name: string): string => `declared:${name}`

const ATTENTION_STATES = new Set([
  EDeclaredServiceState.Stale,
  EDeclaredServiceState.Failed,
  EDeclaredServiceState.CrashLooping,
])

const LIVE_STATES = new Set([EDeclaredServiceState.Running, EDeclaredServiceState.Stale])

const snapshotFor = (args: {
  view: DeclaredServiceView
  services: readonly ServiceSnapshot[]
}): ServiceSnapshot | undefined =>
  args.services.find((one) => one.serviceId === args.view.serviceId) ??
  args.services.findLast((one) => one.name === args.view.name)

export function buildServiceRows(args: {
  declared: DeclaredServicesView | null
  services: readonly ServiceSnapshot[]
}): readonly ServiceRow[] {
  const views = args.declared?.services ?? []
  const names = new Set(views.map((view) => view.name))
  const first = views.map(
    (view): ServiceRow => ({
      key: declaredKey(view.name),
      name: view.name,
      declared: view,
      snapshot: snapshotFor({ view, services: args.services }),
    }),
  )
  const rest = args.services
    .filter((one) => one.name === undefined || !names.has(one.name))
    .map((one): ServiceRow => ({ key: one.serviceId, name: serviceNameLabel(one), snapshot: one }))

  return [...first, ...rest]
}

export const isRowRunning = (row: ServiceRow): boolean =>
  row.declared === undefined
    ? row.snapshot !== undefined && isServiceRunning(row.snapshot)
    : LIVE_STATES.has(row.declared.state)

export function rowTone(row: ServiceRow): EServiceTone {
  if (row.declared !== undefined && ATTENTION_STATES.has(row.declared.state)) {
    return EServiceTone.Attention
  }
  return isRowRunning(row) ? EServiceTone.Ok : EServiceTone.Idle
}

export const rowUrl = (row: ServiceRow): string | undefined => row.declared?.url

export const rowServiceId = (row: ServiceRow): string | undefined =>
  row.declared?.serviceId ?? row.snapshot?.serviceId

export function rowStateLabel(args: { row: ServiceRow; now: number }): string {
  const { declared, snapshot } = args.row
  if (declared === undefined) {
    return snapshot === undefined ? '' : serviceReadout({ service: snapshot, now: args.now })
  }
  if (declared.state === EDeclaredServiceState.Stopped && declared.serviceId === undefined) {
    return 'not started'
  }
  if (declared.state === EDeclaredServiceState.Running && snapshot !== undefined) {
    return serviceReadout({ service: snapshot, now: args.now })
  }
  return declared.state
}

export function rowActions(row: ServiceRow): { start: boolean; restart: boolean; stop: boolean } {
  const serviceId = rowServiceId(row)
  const declared = row.declared
  const live =
    declared === undefined
      ? row.snapshot !== undefined && isServiceRunning(row.snapshot)
      : declared.state !== EDeclaredServiceState.Stopped &&
        declared.state !== EDeclaredServiceState.Failed
  return {
    start: declared !== undefined && declared.state !== EDeclaredServiceState.Running,
    restart: declared !== undefined && serviceId !== undefined,
    stop: serviceId !== undefined && live,
  }
}

const rowMatches = (args: { row: ServiceRow; key: string }): boolean =>
  args.row.key === args.key || args.row.snapshot?.serviceId === args.key

export function openServices(args: { rows: readonly ServiceRow[]; key?: string }): ServicesState {
  const asked = args.rows.findIndex(
    (row) => args.key !== undefined && rowMatches({ row, key: args.key }),
  )
  if (asked >= 0) return { index: asked }

  const running = args.rows.findIndex(isRowRunning)
  return { index: Math.max(running, 0) }
}

export function moveServiceSelection(args: {
  state: ServicesState
  count: number
  delta: number
}): ServicesState {
  if (args.count <= 0) return { index: 0 }

  const moved = args.state.index + Math.trunc(args.delta)
  return { index: Math.min(Math.max(moved, 0), args.count - 1) }
}

export function selectService(args: { rows: readonly ServiceRow[]; key: string }): ServicesState {
  const found = args.rows.findIndex((row) => rowMatches({ row, key: args.key }))
  return { index: Math.max(found, 0) }
}

export function selectedService(args: {
  state: ServicesState
  rows: readonly ServiceRow[]
}): ServiceRow | undefined {
  return args.rows[Math.min(Math.max(args.state.index, 0), args.rows.length - 1)]
}

export const isServiceAlive = (service: {
  status: EServiceStatus
  exitCode?: number | undefined
}): boolean => mayStillBeAlive(service)

export function serviceNameLabel(service: { command: string; description: string }): string {
  const named = service.description.trim()
  return named === '' ? service.command.replace(/\s+/g, ' ').trim() : named
}

export function serviceStateLabel(service: ServiceSnapshot): string {
  if (service.status === EServiceStatus.Running) return 'running'
  if (service.status === EServiceStatus.Killed) {
    if (service.killedBy === EKilledBy.User) return 'stopped by you'
    if (service.killedBy === EKilledBy.Model) return 'stopped by atlas'
    if (service.killedBy === EKilledBy.SessionEnd) return 'stopped at session end'
    return 'stopped'
  }
  if (service.exitCode === undefined || service.exitCode === 0) return 'exited'
  return `exit ${service.exitCode}`
}

const instantOf = (iso: string): number | null => {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

const settledAt = (service: ServiceSnapshot): number | null => {
  if (isServiceRunning(service)) return null
  return service.endedAt === undefined ? null : instantOf(service.endedAt)
}

export function serviceElapsedMs(args: { service: ServiceSnapshot; now: number }): number | null {
  const started = instantOf(args.service.startedAt)
  if (started === null) return null

  return Math.max(0, (settledAt(args.service) ?? args.now) - started)
}

const READOUT_SEPARATOR = ' · '

export function serviceReadout(args: { service: ServiceSnapshot; now: number }): string {
  const state = serviceStateLabel(args.service)
  const elapsed = serviceElapsedMs(args)
  return elapsed === null ? state : `${state}${READOUT_SEPARATOR}${formatElapsed(elapsed)}`
}
