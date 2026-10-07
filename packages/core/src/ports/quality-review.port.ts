import type { EventDraft } from '../events/body'
import type { Event } from '../events/envelope'
import type { RunId } from '../events/ids'
import type { CapturedFileChange } from '../quality/change'
import type { QualityCoverageDiagnostic } from '../quality/policy'
import type { ToolCall } from '../tools/tool'

export abstract class QualityReviewPort {
  abstract captureEnabled(): boolean

  abstract review(args: {
    call: ToolCall
    runId: RunId
    changes: readonly CapturedFileChange[]
    captureFaults: readonly QualityCoverageDiagnostic[]
    events: readonly Event[]
    projectDirectory: string
    signal: AbortSignal
    deadlineAt?: number
  }): Promise<readonly EventDraft[]>
}
