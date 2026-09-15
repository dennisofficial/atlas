import type { ThreadId } from '../events/ids'
import type { EExecutionLocation } from '../execution/location'

export abstract class ExecutionLocationSinkPort {
  abstract note(args: { threadId: ThreadId; location: EExecutionLocation }): void
}

export class NoopExecutionLocationSink extends ExecutionLocationSinkPort {
  note(): void {}
}
