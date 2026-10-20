import type { ThreadId } from '../events/ids'

export abstract class ExecutionLocationSinkPort {
  abstract refresh(args: { threadId: ThreadId }): void | Promise<void>
}

export class NoopExecutionLocationSink extends ExecutionLocationSinkPort {
  refresh(): void {}
}
