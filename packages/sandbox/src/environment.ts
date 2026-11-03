import { DAEMON_OOM_SCORE_ADJ, SANDBOX_WORKLOADS_ENV } from '@dltech/atlas-wire'

import { WORK_PIDS_MAX, WORKLOAD_CGROUP_ENV, WORKLOAD_PIDS_MAX_ENV } from './workload-cgroups'

export const sandboxIsolatedEnv = (args: {
  env: Record<string, string | undefined>
  platform?: NodeJS.Platform | undefined
}): Record<string, string | undefined> => {
  const platform = args.platform ?? process.platform
  if (platform !== 'linux') return {}
  const workGroup = args.env[WORKLOAD_CGROUP_ENV]
  if (workGroup === undefined || workGroup === '') return {}
  return {
    [SANDBOX_WORKLOADS_ENV]: '1',
    [WORKLOAD_CGROUP_ENV]: workGroup,
    [WORKLOAD_PIDS_MAX_ENV]: String(WORK_PIDS_MAX),
    [DAEMON_OOM_SCORE_ADJ]: '-900',
  }
}
