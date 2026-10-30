export enum EDesktopUpdateState {
  Idle = 'idle',
  Ready = 'ready',
}

export interface IDesktopUpdateStatus {
  state: EDesktopUpdateState
  version?: string
}

export interface IDesktopUpdatesPort {
  status: () => IDesktopUpdateStatus
  restart: () => Promise<void>
}

export const UPDATE_PATH = '/desktop/update'
export const UPDATE_RESTART_PATH = '/desktop/update/restart'

export function createUpdateHandler({
  updates,
}: {
  updates: IDesktopUpdatesPort
}): (request: Request, pathname: string) => Response | undefined {
  return (request, pathname) => {
    if (pathname === UPDATE_PATH && request.method === 'GET') {
      return Response.json(updates.status())
    }
    if (pathname === UPDATE_RESTART_PATH && request.method === 'POST') {
      if (updates.status().state !== EDesktopUpdateState.Ready) {
        return Response.json({ message: 'No update is ready' }, { status: 409 })
      }
      void updates.restart().catch(() => undefined)
      return new Response(null, { status: 202 })
    }
    return undefined
  }
}
