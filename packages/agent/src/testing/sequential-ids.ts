import {
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CallId,
  type EventId,
  type IdPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

export class SequentialIds implements IdPort {
  private counter = 0

  private next(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.counter}`
  }

  nextThreadId = (): ThreadId => toThreadId(this.next('thread'))
  nextRunId = (): RunId => toRunId(this.next('run'))
  nextEventId = (): EventId => toEventId(this.next('event'))
  nextCallId = (): CallId => toCallId(this.next('call'))
}
