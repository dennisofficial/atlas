import { startNextServer, type INextServer } from '../host/next-server'

export type TStartServer = (args: { root: string; bunPath: string }) => Promise<INextServer>

export interface IAppServer {
  origin: () => string
  usedFallback: () => boolean
  restart: (args: { root: string; fallback: string }) => Promise<{ usedFallback: boolean }>
  stop: () => Promise<void>
}

interface ISession {
  server: INextServer
  usedFallback: boolean
}

async function open({
  root,
  fallback,
  bunPath,
  start,
}: {
  root: string
  fallback: string
  bunPath: string
  start: TStartServer
}): Promise<ISession> {
  try {
    return { server: await start({ root, bunPath }), usedFallback: false }
  } catch (error) {
    if (root === fallback) throw error
    return { server: await start({ root: fallback, bunPath }), usedFallback: true }
  }
}

export async function startAppServer({
  root,
  fallback,
  bunPath,
  start = startNextServer,
}: {
  root: string
  fallback: string
  bunPath: string
  start?: TStartServer
}): Promise<IAppServer> {
  let session = await open({ root, fallback, bunPath, start })
  return {
    origin: () => session.server.origin,
    usedFallback: () => session.usedFallback,
    restart: async ({ root: nextRoot, fallback: nextFallback }) => {
      const next = await open({ root: nextRoot, fallback: nextFallback, bunPath, start })
      const previous = session
      session = next
      await previous.server.stop()
      return { usedFallback: next.usedFallback }
    },
    stop: () => session.server.stop(),
  }
}
