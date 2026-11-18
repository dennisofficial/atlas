import { FaultProxy } from '@dltech/atlas-host/testing'

export const proxiedDatabaseUrl = (args: { databaseUrl: string; port: number }): string => {
  const url = new URL(args.databaseUrl)
  url.hostname = '127.0.0.1'
  url.port = String(args.port)
  return url.toString()
}

export const startOwnDaemonProxy = async (args: {
  daemonUrl: string
}): Promise<{ proxy: FaultProxy; url: string }> => {
  const target = new URL(args.daemonUrl)
  const proxy = await FaultProxy.start({
    target: { host: target.hostname, port: Number(target.port) },
  })
  return { proxy, url: `ws://127.0.0.1:${proxy.port}` }
}
