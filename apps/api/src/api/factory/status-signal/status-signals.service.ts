import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  STATUS_SIGNAL_ADAPTERS,
  type EStatusSignal,
  type StatusSignalAdapters,
  type StatusSignalRef,
} from './status-signal'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Routes a status signal to the adapter for the comment's surface. Never throws — a signal is a
 * courtesy to the human, and its failure must not take down the webhook or reply that raised it.
 */
@Injectable()
export class StatusSignalsService {
  private readonly logger = new Logger(StatusSignalsService.name)

  constructor(
    @Inject(STATUS_SIGNAL_ADAPTERS) private readonly adapters: StatusSignalAdapters,
  ) {}

  async set(args: { ref: StatusSignalRef; signal: EStatusSignal }): Promise<void> {
    const adapter = this.adapters.get(args.ref.surface)
    if (adapter === undefined) {
      this.logger.warn(`no status-signal adapter for surface ${args.ref.surface}`)
      return
    }
    await adapter.set(args).catch((failure: unknown) => {
      this.logger.warn(`status signal set failed on ${args.ref.externalId}: ${messageOf(failure)}`)
    })
  }

  async clear(args: { ref: StatusSignalRef }): Promise<void> {
    const adapter = this.adapters.get(args.ref.surface)
    if (adapter === undefined) return
    await adapter.clear(args).catch((failure: unknown) => {
      this.logger.warn(`status signal clear failed on ${args.ref.externalId}: ${messageOf(failure)}`)
    })
  }
}
