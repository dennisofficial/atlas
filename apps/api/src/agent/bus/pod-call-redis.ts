import { Redis } from 'ioredis'

export type PodCallClients = Readonly<{ publisher: Redis; subscriber: Redis }>

export const podCallClientsOf = (args: {
  url: string
  clients?: PodCallClients | undefined
}): PodCallClients => {
  const options = {
    // Upstash drops idle TCP connections after ~30 s.
    keepAlive: 10_000,
    maxRetriesPerRequest: 3,
  }
  return {
    // A request resent after a reconnect would reach the holder twice, and a queued one
    // would land after its deadline, so the publisher sends neither.
    publisher:
      args.clients?.publisher ??
      new Redis(args.url, {
        ...options,
        autoResendUnfulfilledCommands: false,
        enableOfflineQueue: false,
      }),
    subscriber:
      args.clients?.subscriber ?? new Redis(args.url, { ...options, autoResubscribe: false }),
  }
}
