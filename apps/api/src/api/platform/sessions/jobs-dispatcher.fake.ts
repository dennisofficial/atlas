import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'

export class NoJobsDispatcher extends JobsProjectDispatcher {
  async dispatch(): Promise<{ runId: string }> {
    return { runId: 'none' }
  }
}
