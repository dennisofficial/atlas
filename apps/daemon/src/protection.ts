import { EProtection, type DaemonMemory, type ProtectionReport } from '@dltech/atlas-protocol'
import {
  CGROUP_ROOT,
  WORKLOAD_CGROUP_ENV,
  applyDaemonProtection,
  type DaemonProtectionReport,
} from '@dltech/atlas-sandbox'
import { readFileSync } from 'node:fs'

export const CGROUP_ROOT_ENV = 'ATLAS_DAEMON_CGROUP_ROOT'

export const protectionReportOf = (report: DaemonProtectionReport): ProtectionReport => {
  if (!report.enabled) {
    return {
      cgroups: { status: EProtection.Unsupported },
      oomScoreAdj: { status: EProtection.Unsupported },
    }
  }
  const { cgroups, oomScoreAdj } = report
  return {
    cgroups:
      cgroups.enabled && cgroups.ok
        ? { status: EProtection.Applied }
        : {
            status: EProtection.Failed,
            error: cgroups.enabled ? `${cgroups.step}: ${cgroups.error}` : 'cgroups disabled',
          },
    oomScoreAdj: oomScoreAdj.applied
      ? { status: EProtection.Applied }
      : { status: EProtection.Failed, error: oomScoreAdj.error },
  }
}

export const protectDaemon = (env: Record<string, string | undefined>): ProtectionReport =>
  protectionReportOf(applyDaemonProtection({ env, root: env[CGROUP_ROOT_ENV] ?? CGROUP_ROOT }))

export const workMemory = (env: Record<string, string | undefined>): DaemonMemory | undefined => {
  const workGroup = env[WORKLOAD_CGROUP_ENV]
  if (workGroup === undefined || workGroup === '') return undefined
  try {
    const current = Number(readFileSync(`${workGroup}/memory.current`, 'utf8').trim())
    const max = Number(readFileSync(`${workGroup}/memory.max`, 'utf8').trim())
    if (!Number.isInteger(current) || !Number.isInteger(max)) return undefined
    return { current, max }
  } catch {
    return undefined
  }
}
