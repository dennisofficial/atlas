import {
  EDeclaredServiceState,
  EServiceStatus,
  type DeclaredServiceView,
  type DeclaredServicesView,
} from '@dltech/atlas-core'

import { hashOfDeclared, linksOf } from './declared-launch'
import type { DeclaredServicesRead } from './declared-services'
import type { ServiceSnapshot } from './service-process'

export const STALE_REASON = 'services.yaml changed since it started; restart to apply'

export function buildDeclaredView({
  read,
  snapshots,
  inflight,
  crashLooping,
}: {
  read: DeclaredServicesRead
  snapshots: readonly ServiceSnapshot[]
  inflight: ReadonlySet<string>
  crashLooping: (name: string) => boolean
}): DeclaredServicesView {
  const services = read.services.map((declared): DeclaredServiceView => {
    const latest = snapshots.filter((one) => one.name === declared.name).at(-1)
    const base = {
      name: declared.name,
      serviceId: latest?.serviceId,
      port: latest?.port ?? declared.port,
      url: latest?.exposure?.url,
      links: linksOf({ declared, publicUrl: latest?.exposure?.url }),
      logPath: latest?.logPath,
    }
    if (inflight.has(declared.name)) return { ...base, state: EDeclaredServiceState.Starting }
    if (crashLooping(declared.name)) {
      return {
        ...base,
        state: EDeclaredServiceState.CrashLooping,
        reason: 'it kept crashing and was given up on; restart it to try again',
      }
    }
    if (latest === undefined) return { ...base, state: EDeclaredServiceState.Stopped }
    if (latest.status === EServiceStatus.Running) {
      const stale =
        latest.declarationHash !== undefined && latest.declarationHash !== hashOfDeclared(declared)
      return stale
        ? { ...base, state: EDeclaredServiceState.Stale, reason: STALE_REASON }
        : { ...base, state: EDeclaredServiceState.Running }
    }
    if (latest.status === EServiceStatus.Exited && latest.exitCode !== 0) {
      return {
        ...base,
        state: EDeclaredServiceState.Failed,
        reason: `exited with code ${latest.exitCode ?? 'unknown'}`,
      }
    }
    return { ...base, state: EDeclaredServiceState.Stopped }
  })
  return {
    services,
    rejections: read.rejections.map((one) => ({ name: one.name, detail: one.detail })),
  }
}
