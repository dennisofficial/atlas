import type { PrEventFrame } from '../../cloud/pr-event-frame'

/**
 * A read tap on the pull-request event stream this plugin consumes. The plugin routes every frame
 * it admits into the session's own intake; this port is how a surface (the TUI's parked-cloud
 * forwarder) observes the same frames without the harness knowing anything about cloud routing.
 * One call per frame, nothing else — the consumer owns matching, liveness, and delivery.
 */
export abstract class PrEventFrameSink {
  abstract onPrEvent(frame: PrEventFrame): void
}

/**
 * The concrete sink the plugin holds. The contribution registers the instance, not a set consumer
 * fixed at build time, so the TUI can attach its forwarder after the surface binding runs — the
 * plugin contributes before the surface `bind` that creates the consumer.
 */
export class MutablePrEventSink extends PrEventFrameSink {
  private consumer: ((frame: PrEventFrame) => void) | null = null

  set(consumer: ((frame: PrEventFrame) => void) | null): void {
    this.consumer = consumer
  }

  onPrEvent(frame: PrEventFrame): void {
    this.consumer?.(frame)
  }
}
