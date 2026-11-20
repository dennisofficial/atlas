import { readCgroupCpuUsec } from '@dltech/atlas-sandbox'

export type DaemonCpuReading = { usageUsec: number | null }

export const daemonCpuReadingOf = (
  args: {
    root?: string | undefined
    read?: ((path: string) => string | undefined) | undefined
  } = {},
): DaemonCpuReading => ({ usageUsec: readCgroupCpuUsec(args) ?? null })
