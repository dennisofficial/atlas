import { applyServePriority, prepareWorkloadCgroups } from '@dltech/atlas-sandbox'

export type BootReport = {
  cgroups: ReturnType<typeof prepareWorkloadCgroups>
  priority: ReturnType<typeof applyServePriority>
}

export const applyDaemonBoot = (args: { env: Record<string, string | undefined> }): BootReport => ({
  priority: applyServePriority({ env: args.env }),
  cgroups: prepareWorkloadCgroups({ env: args.env }),
})
