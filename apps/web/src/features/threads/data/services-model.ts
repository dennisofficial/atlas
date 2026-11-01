import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'
import type {
  DeclaredServiceLinkWire,
  DeclaredServiceStateWire,
  DeclaredServiceViewWire,
  DeclaredServicesViewWire,
  ServiceSnapshotWire,
} from '@dltech/atlas-wire/web'

import { previewIdOf } from './preview-ports'

export type ServiceActions = {
  start: boolean
  restart: boolean
  stop: boolean
}

const ACTIONS: Record<DeclaredServiceStateWire, ServiceActions> = {
  stopped: { start: true, restart: false, stop: false },
  starting: { start: false, restart: false, stop: true },
  running: { start: false, restart: true, stop: true },
  stale: { start: false, restart: true, stop: true },
  failed: { start: true, restart: false, stop: false },
  'crash-looping': { start: true, restart: false, stop: false },
}

const LABELS: Record<DeclaredServiceStateWire, string> = {
  stopped: 'stopped',
  starting: 'starting',
  running: 'running',
  stale: 'config changed',
  failed: 'failed',
  'crash-looping': 'crash looping',
}

export const serviceActionsOf = (state: DeclaredServiceStateWire): ServiceActions => ACTIONS[state]

export const serviceStateLabelOf = (state: DeclaredServiceStateWire): string => LABELS[state]

export const restartEmphasizedOf = (state: DeclaredServiceStateWire): boolean => state === 'stale'

export const hasServicesToShow = (view: DeclaredServicesViewWire | null): boolean =>
  view !== null && (view.services.length > 0 || view.rejections.length > 0)

export const declaredNamesOf = (view: DeclaredServicesViewWire | null): ReadonlySet<string> =>
  new Set(view === null ? [] : view.services.map((service) => service.name))

export const undeclaredServicesOf = (args: {
  services: readonly ServiceSnapshotWire[]
  declared: ReadonlySet<string>
}): ServiceSnapshotWire[] =>
  args.services.filter((service) => service.name === undefined || !args.declared.has(service.name))

export const linksOf = (service: DeclaredServiceViewWire): readonly DeclaredServiceLinkWire[] => {
  if (service.links.length > 0) return service.links
  return service.url === undefined ? [] : [{ url: service.url, title: service.url }]
}

export function linkSplitOf(service: DeclaredServiceViewWire): {
  inline: DeclaredServiceLinkWire | undefined
  extra: readonly DeclaredServiceLinkWire[]
} {
  const links = linksOf(service)
  if (service.reason !== undefined) return { inline: undefined, extra: links }
  return { inline: links[0], extra: links.slice(1) }
}

export const sameViewOf = (args: {
  previous: DeclaredServicesViewWire | null
  next: DeclaredServicesViewWire
}): boolean => JSON.stringify(args.previous) === JSON.stringify(args.next)

export enum EServiceKind {
  Web = 'web',
  Api = 'api',
  Database = 'database',
}

export enum EOpenTarget {
  Preview = 'preview',
  Log = 'log',
}

export function serviceKindOf(service: DeclaredServiceViewWire): EServiceKind | undefined {
  return Object.values(EServiceKind).find((kind) => kind === service.type)
}

export function openTargetOf(args: {
  service: DeclaredServiceViewWire
  ports: readonly PreviewPort[]
}): EOpenTarget {
  const { service, ports } = args
  if (service.serviceId === undefined) return EOpenTarget.Log
  if (serviceKindOf(service) !== EServiceKind.Web) return EOpenTarget.Log
  const id = previewIdOf(service.serviceId)
  return ports.some((port) => port.id === id) ? EOpenTarget.Preview : EOpenTarget.Log
}
