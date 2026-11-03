import { describeCallsConformance } from './calls'
import { describeExecConformance } from './exec'
import { describeFencingConformance } from './fencing'
import { describeFilesConformance } from './files'
import { describeMcpConformance } from './mcp'
import { describeServicesConformance } from './services'
import type { DaemonConformanceTarget } from './support'

export type { DaemonConformanceTarget, DaemonHandle } from './support'

export const describeDaemonConformance = (target: DaemonConformanceTarget): void => {
  describeFencingConformance(target)
  describeCallsConformance(target)
  describeExecConformance(target)
  describeFilesConformance(target)
  describeMcpConformance(target)
  describeServicesConformance(target)
}
