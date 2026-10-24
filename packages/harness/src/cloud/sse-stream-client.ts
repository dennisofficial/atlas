import type { AppRouter } from '@dltech/atlas-api-router'
import { createTRPCClient, httpSubscriptionLink } from '@trpc/client'
import { EventSource, type EventSourceFetchInit, type FetchLikeResponse } from 'eventsource'

export const createStreamClient = (args: {
  baseUrl: string
  token: string
  clientVersion: string
  onBytes: () => void
  onStatus: (status: number) => void
}) => {
  const signOfLife = (): TransformStream<Uint8Array, Uint8Array> =>
    new TransformStream({
      transform(chunk, controller) {
        args.onBytes()
        controller.enqueue(chunk)
      },
    })

  // The eventsource ponyfill is the only EventSource that takes a custom fetch, which is how the
  // bearer token reaches the stream: the browser EventSource cannot send headers.
  const watchedFetch = async (
    input: string | URL,
    init: EventSourceFetchInit,
  ): Promise<FetchLikeResponse> => {
    const response = await fetch(input, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${args.token}`,
        'atlas-client-version': args.clientVersion,
      },
    })
    args.onStatus(response.status)
    return {
      body: response.body === null ? null : response.body.pipeThrough(signOfLife()),
      url: response.url,
      status: response.status,
      redirected: response.redirected,
      headers: response.headers,
    }
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpSubscriptionLink({
        url: `${args.baseUrl.replace(/\/+$/, '')}/v1/trpc`,
        EventSource,
        eventSourceOptions: () => ({ fetch: watchedFetch }),
      }),
    ],
  })
}
