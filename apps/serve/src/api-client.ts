import { createApiClient as createSharedApiClient } from '@dltech/atlas-api-router'

export { controlPlaneError, detailsOf, httpStatusOf } from '@dltech/atlas-api-router'

export type ApiRemote = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}

export const createApiClient = (remote: ApiRemote) =>
  createSharedApiClient({
    baseUrl: remote.controlPlaneUrl,
    token: remote.token,
    clientVersion: remote.clientVersion,
    fetchFn: remote.fetchFn,
  })
