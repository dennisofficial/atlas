import { LogPort, type LogEntry } from '@dltech/atlas-core'

export class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}
