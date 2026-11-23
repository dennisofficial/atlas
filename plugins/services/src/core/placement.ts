import {
  deriveServicePort,
  EServiceStatus,
  internalServiceUrl,
  nextServicePort,
  SERVICE_PORT_SPAN,
  type ResolvedServiceReference,
} from '@dltech/atlas-core'

import type { ServiceRow } from './roster'

const CURRENT_DIRECTORY = /^(\.\/)+|^\.$/

export const serviceCwdOf = (args: { root: string; cwd?: string | undefined }): string => {
  if (args.cwd === undefined) return args.root
  if (args.cwd.startsWith('/')) return args.cwd
  const relative = args.cwd.replace(CURRENT_DIRECTORY, '').replace(/\/+$/, '')
  if (relative === '') return args.root
  return `${args.root.replace(/\/+$/, '')}/${relative}`
}

const isRunning = (row: ServiceRow): boolean => row.status === EServiceStatus.Running

const isDeclaredAt = (args: { row: ServiceRow; name: string; root: string }): boolean =>
  args.row.declarationHash !== undefined &&
  args.row.name === args.name &&
  args.row.root === args.root

export const runningDeclaredOf = (args: {
  rows: readonly ServiceRow[]
  name: string
  root: string
}): ServiceRow | undefined =>
  args.rows.find((row) => isRunning(row) && isDeclaredAt({ row, name: args.name, root: args.root }))

export const heldPortsOf = (args: {
  rows: readonly ServiceRow[]
  name: string
  root: string
}): Set<number> =>
  new Set(
    args.rows
      .filter((row) => isRunning(row) && !isDeclaredAt({ row, name: args.name, root: args.root }))
      .flatMap((row) => (row.port === undefined ? [] : [row.port])),
  )

export const servicePortOf = async (args: {
  name: string
  root: string
  declared: number | undefined
  held: ReadonlySet<number>
  isFree: (port: number) => Promise<boolean>
}): Promise<number | undefined> => {
  if (args.declared === undefined) return undefined
  const free = async (port: number): Promise<boolean> =>
    !args.held.has(port) && (await args.isFree(port))
  if (await free(args.declared)) return args.declared
  let port = deriveServicePort({ name: `${args.name}@${args.root}` })
  for (let attempt = 0; attempt < SERVICE_PORT_SPAN; attempt += 1) {
    if (await free(port)) return port
    port = nextServicePort({ port })
  }
  return args.declared
}

export const referencesAt = (args: {
  rows: readonly ServiceRow[]
  root: string
}): Record<string, ResolvedServiceReference> => {
  const resolved: Record<string, ResolvedServiceReference> = {}
  for (const row of args.rows) {
    if (!isRunning(row) || row.root !== args.root || row.declarationHash === undefined) continue
    if (row.name === undefined || row.port === undefined) continue
    resolved[row.name] = {
      url: internalServiceUrl({ port: row.port }),
      port: row.port,
      ...(row.url === undefined ? {} : { publicUrl: row.url }),
    }
  }
  return resolved
}

export const serviceLabelOf = (row: Pick<ServiceRow, 'name' | 'branch' | 'command'>): string => {
  const base = (row.name ?? row.command).trim()
  return row.branch === undefined ? base : `${base} (${row.branch})`
}
