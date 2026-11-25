import { Global, Module, type Provider } from '@nestjs/common'
import type { ErrorReporter, ProductAnalytics } from '@dltech/atlas-observability'
import { AnalyticsModule, ERROR_REPORTER, PRODUCT_ANALYTICS } from '../../agent'
import { ApiTrpcContext } from './api-trpc-context'
import { ApiLatencyMiddleware } from './api-latency.middleware'
import { HttpErrorMiddleware } from './http-error.middleware'
import { ThrottleMiddleware } from './throttle.middleware'

const httpErrorProvider: Provider = {
  provide: HttpErrorMiddleware,
  useFactory: (errors: ErrorReporter) => new HttpErrorMiddleware({ errors }),
  inject: [ERROR_REPORTER],
}

const apiLatencyProvider: Provider = {
  provide: ApiLatencyMiddleware,
  useFactory: (analytics: ProductAnalytics) => new ApiLatencyMiddleware({ analytics }),
  inject: [PRODUCT_ANALYTICS],
}

@Global()
@Module({
  imports: [AnalyticsModule],
  providers: [ApiTrpcContext, httpErrorProvider, ThrottleMiddleware, apiLatencyProvider],
  exports: [ApiTrpcContext, HttpErrorMiddleware, ThrottleMiddleware, ApiLatencyMiddleware],
})
export class ApiTrpcModule {}
