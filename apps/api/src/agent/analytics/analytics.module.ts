import { Global, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common'
import type { ProductAnalytics, TracePort } from '@dltech/atlas-observability'

import { serverAnalytics } from './singleton'
import { PRODUCT_ANALYTICS, TRACE_FOR } from './tokens'

const analyticsProvider: Provider = {
  provide: PRODUCT_ANALYTICS,
  useFactory: (): ProductAnalytics => serverAnalytics().analytics,
}

const traceForProvider: Provider = {
  provide: TRACE_FOR,
  useFactory: (): ((distinctId: string) => TracePort) => serverAnalytics().traceFor,
}

class AnalyticsShutdown implements OnApplicationShutdown {
  constructor(private readonly analytics: ProductAnalytics) {}

  async onApplicationShutdown(): Promise<void> {
    await this.analytics.flush()
  }
}

const analyticsShutdownProvider: Provider = {
  provide: AnalyticsShutdown,
  useFactory: (analytics: ProductAnalytics) => new AnalyticsShutdown(analytics),
  inject: [PRODUCT_ANALYTICS],
}

@Global()
@Module({
  providers: [analyticsProvider, traceForProvider, analyticsShutdownProvider],
  exports: [PRODUCT_ANALYTICS, TRACE_FOR],
})
export class AnalyticsModule {}
