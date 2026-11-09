import { LogPort } from '@dltech/atlas-observability'

export class JsonLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}
