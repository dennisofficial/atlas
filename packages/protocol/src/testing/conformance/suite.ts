import { describeCallsConformance } from './calls'
import { describeExecConformance } from './exec'
import { describeFencingConformance } from './fencing'
import { describeFilesConformance } from './files'
import { describeShellsConformance } from './shells'
import type { DaemonConformanceTarget } from './support'

export type { DaemonConformanceTarget, DaemonHandle } from './support'

export const describeDaemonConformance = (target: DaemonConformanceTarget): void => {
  describeFencingConformance(target)
  describeCallsConformance(target)
  describeExecConformance(target)
  describeFilesConformance(target)
  describeShellsConformance(target)
}
