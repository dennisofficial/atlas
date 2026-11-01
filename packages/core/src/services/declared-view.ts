import type { EServiceType } from './service-type'

export enum EDeclaredServiceState {
  Stopped = 'stopped',
  Starting = 'starting',
  Running = 'running',
  Stale = 'stale',
  Failed = 'failed',
  CrashLooping = 'crash-looping',
}

export type DeclaredServiceLink = {
  url: string
  title: string
  description?: string | undefined
}

export type DeclaredServiceView = {
  name: string
  state: EDeclaredServiceState
  type?: EServiceType | undefined
  serviceId?: string | undefined
  port?: number | undefined
  url?: string | undefined
  links: readonly DeclaredServiceLink[]
  logPath?: string | undefined
  reason?: string | undefined
}

export type DeclaredServicesView = {
  services: readonly DeclaredServiceView[]
  rejections: readonly { name?: string | undefined; detail: string }[]
}
