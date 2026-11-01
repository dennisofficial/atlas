import { EventSource } from 'eventsource'

import { createApiPodBridge, type ApiPodBridgeOptions } from './api-pod-bridge'
import type { PodApiClient } from './api-pod-client'
import { createHarnessApiClient } from './api-trpc-client'
import type { CloudBridge } from './cloud-bridge'
import type { CloudSession } from './cloud-session'
import { CloudError } from './cloud-transport'

export const SIGN_IN_FOR_PODS_MESSAGE = 'sign in to Atlas Cloud to start a session'

const UNAUTHORIZED = 401

export type SignedInApiPodBridgeOptions = Omit<ApiPodBridgeOptions, 'api'> & {
  session: () => CloudSession | null
  clientVersion: string
  fetchFn?: typeof fetch | undefined
}

const sessionClientOf = (options: SignedInApiPodBridgeOptions): (() => PodApiClient) => {
  let held: { url: string; token: string; api: PodApiClient } | undefined
  return () => {
    const session = options.session()
    if (session === null) {
      throw new CloudError({ status: UNAUTHORIZED, message: SIGN_IN_FOR_PODS_MESSAGE })
    }
    if (held?.url === session.url && held.token === session.token) return held.api
    const api = createHarnessApiClient({
      url: session.url,
      token: session.token,
      clientVersion: options.clientVersion,
      fetchFn: options.fetchFn ?? fetch,
      EventSource,
    })
    held = { url: session.url, token: session.token, api }
    return api
  }
}

const rereadingClientOf = (apiOf: () => PodApiClient): PodApiClient => ({
  threads: { create: { mutate: async (input) => apiOf().threads.create.mutate(input) } },
  threadSandbox: {
    provision: { mutate: async (input) => apiOf().threadSandbox.provision.mutate(input) },
  },
  threadMessages: {
    send: { mutate: async (input) => apiOf().threadMessages.send.mutate(input) },
  },
  threadPod: {
    status: { query: async (input) => apiOf().threadPod.status.query(input) },
    connect: { mutate: async (input) => apiOf().threadPod.connect.mutate(input) },
    resize: { mutate: async (input) => apiOf().threadPod.resize.mutate(input) },
    destroy: { mutate: async (input) => apiOf().threadPod.destroy.mutate(input) },
  },
  sandboxCheckpoint: {
    get: { query: async (input) => apiOf().sandboxCheckpoint.get.query(input) },
  },
  threadEvents: {
    stream: {
      subscribe: (input, handlers) => apiOf().threadEvents.stream.subscribe(input, handlers),
    },
  },
})

export const createSignedInApiPodBridge = (options: SignedInApiPodBridgeOptions): CloudBridge => {
  const { session, clientVersion, fetchFn, ...bridgeOptions } = options
  return createApiPodBridge({
    ...bridgeOptions,
    api: rereadingClientOf(sessionClientOf({ session, clientVersion, fetchFn })),
  })
}
