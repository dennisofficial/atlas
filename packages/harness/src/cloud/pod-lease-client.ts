import { CloudError, cloudRequest } from './cloud-transport'

const LEASED_ELSEWHERE =
  "this pod's serve token is already leased to another session — destroy the pod and start the thread again"

export async function putPodLease(args: {
  url: string
  sessionToken: string
  clientVersion: string
  threadId: string
  token: string
  fetchFn?: typeof fetch | undefined
}): Promise<void> {
  try {
    await cloudRequest({
      url: args.url,
      token: args.sessionToken,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn ?? fetch,
      method: 'PUT',
      path: `/v1/pod-leases/${encodeURIComponent(args.threadId)}`,
      body: { token: args.token },
    })
  } catch (error) {
    if (error instanceof CloudError && error.status === 409) {
      throw new CloudError({ status: 409, message: LEASED_ELSEWHERE })
    }
    throw error
  }
}
