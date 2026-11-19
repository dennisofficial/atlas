import { serverObservability, type ServerObservability } from '@dltech/atlas-observability/node'

import { apiVersion } from '../../_lib/version/api-version'

let instance: ServerObservability | undefined

/**
 * One PostHog client for the process. The Nest analytics module and the better-auth hooks both
 * reach it — auth.server is built outside the container — so the queue and flush are shared.
 */
export const serverAnalytics = (): ServerObservability => {
  instance ??= serverObservability({ version: apiVersion() })
  return instance
}
