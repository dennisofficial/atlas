import type { ThreadId } from '@dltech/atlas-core'

import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'

export const registerInBackground = (args: {
  options: Pick<LocalCloudBridgeOptions, 'registration' | 'sendRegistration' | 'onRegistrationFailed'>
  threadId: ThreadId
  token: string
  serveUrl: string
  driveName: string
}): void => {
  const { registration, sendRegistration, onRegistrationFailed } = args.options
  if (registration === undefined || sendRegistration === undefined) return
  const { threadId, token, serveUrl, driveName } = args
  void Promise.resolve()
    .then(() => registration({ threadId }))
    .then((read) => {
      if (read === undefined) return undefined
      return sendRegistration({
        registration: {
          threadId,
          token,
          serveUrl,
          driveName,
          ...(read.metadata === undefined ? {} : { metadata: read.metadata }),
        },
      })
    })
    .catch((failure: unknown) => {
      try {
        onRegistrationFailed?.(failure)
      } catch {
        // the notice itself must never become an unhandled rejection
      }
    })
}
