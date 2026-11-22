import { EPodDiskPressure, podDiskGrowthOf } from '@dltech/atlas-core'
import type { PodDiskPressurePort, PodDiskPressureReport } from '@dltech/atlas-host'

import type { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { AGENT37_MAX_DISK_GB } from '@dltech/atlas-pods/sandbox/agent37/agent37-disk'
import {
  podDiskGrowOneIdempotencyKey,
  podDiskGrowOneTaskContract,
} from './pod-disk-grow-one.contract'

export const podDiskPressurePortOf = (args: {
  dispatcher: JobsProjectDispatcher
}): PodDiskPressurePort => ({
  report: async (report: PodDiskPressureReport) => {
    const targetGb = podDiskGrowthOf({
      usedBytes: report.usedBytes,
      limitBytes: report.limitBytes,
      maxGb: AGENT37_MAX_DISK_GB,
    })
    if (targetGb === undefined) return
    const payload = {
      podSessionId: report.podSessionId,
      usedBytes: report.usedBytes,
      limitBytes: report.limitBytes,
      urgent: report.pressure === EPodDiskPressure.Urgent,
    }
    await args.dispatcher.dispatch({
      task: podDiskGrowOneTaskContract,
      payload,
      idempotencyKey: podDiskGrowOneIdempotencyKey({ payload, targetGb }),
    })
  },
})
