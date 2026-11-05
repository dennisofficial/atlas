import { randomUUID } from 'node:crypto'

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

export class RandomIds implements IdPort {
  nextThreadId(): ThreadId {
    return toThreadId(`brn_${randomUUID()}`)
  }

  nextRunId(): RunId {
    return toRunId(`run_${randomUUID()}`)
  }

  nextEventId(): EventId {
    return toEventId(`evt_${randomUUID()}`)
  }

  nextCallId(): CallId {
    return toCallId(`cal_${randomUUID()}`)
  }
}
