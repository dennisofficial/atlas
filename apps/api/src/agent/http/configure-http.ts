import type { NestExpressApplication } from '@nestjs/platform-express'

import { JSON_BODY_LIMIT, corsOptionsOf } from './cors'

export const configureHttp = (
  app: NestExpressApplication,
  args: { trustedOrigins: readonly string[] },
): void => {
  app.enableCors(corsOptionsOf(args.trustedOrigins))
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
}
