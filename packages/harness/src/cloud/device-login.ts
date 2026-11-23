import {
  beginCloudLogin as beginClientLogin,
  DeviceLoginError,
  pollCloudLogin as pollClientLogin,
  type CloudLoginOutcome,
  type CloudLoginTicket,
} from '@dltech/atlas-client/account'

import { CloudError } from './cloud-client'

export { CLOUD_CLIENT_ID, ECloudLoginPoll } from '@dltech/atlas-client/account'
export type { CloudLoginOutcome, CloudLoginTicket } from '@dltech/atlas-client/account'

const asCloudError = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof DeviceLoginError)
      throw new CloudError({ status: error.status, message: error.message })
    throw error
  }
}

export const beginCloudLogin = (args: {
  url: string
  fetchFn?: typeof fetch
}): Promise<CloudLoginTicket> => asCloudError(() => beginClientLogin(args))

export const pollCloudLogin = (args: {
  ticket: CloudLoginTicket
  fetchFn?: typeof fetch
}): Promise<CloudLoginOutcome> => asCloudError(() => pollClientLogin(args))
