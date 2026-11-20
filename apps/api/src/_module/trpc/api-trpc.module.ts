import { Global, Module, type Provider } from '@nestjs/common'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { AnalyticsModule, PRODUCT_ANALYTICS } from '../../agent'
import { ApiTrpcContext } from './api-trpc-context'
import { ApiLatencyMiddleware } from './api-latency.middleware'
import { HttpErrorMiddleware } from './http-error.middleware'
import { ThrottleMiddleware } from './throttle.middleware'

const apiLatencyProvider: Provider = {
  provide: ApiLatencyMiddleware,
  useFactory: (analytics: ProductAnalytics) => new ApiLatencyMiddleware({ analytics }),
  inject: [PRODUCT_ANALYTICS],
}

@Global()
@Module({
  imports: [AnalyticsModule],
  providers: [ApiTrpcContext, HttpErrorMiddleware, ThrottleMiddleware, apiLatencyProvider],
  exports: [ApiTrpcContext, HttpErrorMiddleware, ThrottleMiddleware, ApiLatencyMiddleware],
})
export class ApiTrpcModule {}
