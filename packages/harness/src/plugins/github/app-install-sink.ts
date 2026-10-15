import type { AppInstallRecommendation } from '../../cloud/pr-subscription-client'

/**
 * A read tap on the app-install recommendation stream, mirroring PrEventFrameSink: the plugin
 * routes every recommendation into the session's own intake; this port is how a surface (the TUI's
 * notice) observes them without the harness knowing about notices. One call per recommendation.
 */
export abstract class AppInstallRecommendationSink {
  abstract onAppInstallRecommended(recommendation: AppInstallRecommendation): void
}

export class MutableAppInstallSink extends AppInstallRecommendationSink {
  private consumer: ((recommendation: AppInstallRecommendation) => void) | null = null

  set(consumer: ((recommendation: AppInstallRecommendation) => void) | null): void {
    this.consumer = consumer
  }

  onAppInstallRecommended(recommendation: AppInstallRecommendation): void {
    this.consumer?.(recommendation)
  }
}
