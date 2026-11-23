import type { IdPort } from '@dltech/atlas-core'
import {
  autoRotateAfterTurn,
  contextPressure,
  EAutoRotate,
  initialMeterState,
  meterOf,
  stepMeter,
} from '@dltech/atlas-core'
import { rotateNow } from '@dltech/atlas-native-commands'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export type HeldRotationRecord = Pick<SessionRecord, 'threadId' | 'eventCache' | 'append'>
export type HeldRotationRuntime = Pick<SessionRuntime, 'model' | 'rotation'>

export type HeldRotationArgs = {
  record(): HeldRotationRecord | undefined
  runtime(): HeldRotationRuntime | undefined
  ids: IdPort
  runningChildren(): number
  log?: LogPort | undefined
}

export class HeldRotation {
  constructor(private readonly args: HeldRotationArgs) {}

  async maybeAutoRotate(): Promise<void> {
    try {
      await this.rotate()
    } catch (error) {
      this.args.log?.warn({
        source: 'holder.rotation',
        message: 'the automatic rotation failed, so the context stays as it is',
        ...logFieldsOf({ error }),
      })
    }
  }

  private async rotate(): Promise<void> {
    if (this.args.runningChildren() > 0) return
    const record = this.args.record()
    const runtime = this.args.runtime()
    if (record === undefined || runtime === undefined) return
    const cache = record.eventCache()
    const meter = meterOf(cache.eventsAfter(0).reduce(stepMeter, initialMeterState))
    const used = meter?.used ?? null
    const window = meter?.window ?? null
    const decision = autoRotateAfterTurn({
      used,
      window,
      atPercent: runtime.rotation.autoRotateAtPercent,
    })
    if (decision !== EAutoRotate.AtTurnEnd) return
    if (used === null || window === null) return
    const result = await rotateNow({
      model: runtime.model,
      visibleEvents: () => cache.visibleLoopEvents(),
      append: async (drafts) => {
        await record.append({
          threadId: record.threadId,
          runId: this.args.ids.nextRunId(),
          drafts,
        })
      },
      auto: { percent: contextPressure({ used, window }).percent },
      log: (message) => this.args.log?.info({ source: 'holder.rotation', message }),
    })
    if (result.kind === 'refused') {
      this.args.log?.warn({
        source: 'holder.rotation',
        message: `the automatic rotation was refused: ${result.reason}`,
      })
    }
  }
}
