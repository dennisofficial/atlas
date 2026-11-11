import { EWebPayloadState, type IWebPayloadStatus } from './web-payload/updater'

export enum EDesktopUpdateState {
  Idle = 'idle',
  Ready = 'ready',
  Restarting = 'restarting',
}

export interface IDesktopUpdateStatus {
  state: EDesktopUpdateState
  version?: string
  error?: string
  web?: IWebPayloadStatus
}

export interface IDesktopUpdatesPort {
  status: () => Promise<IDesktopUpdateStatus>
  check: () => Promise<IDesktopUpdateStatus>
  restart: () => Promise<void>
}

export const UPDATE_PATH = '/desktop/update'
export const UPDATE_CHECK_PATH = '/desktop/update/check'
export const UPDATE_RESTART_PATH = '/desktop/update/restart'

const failed = () => Response.json({ state: EDesktopUpdateState.Idle, error: 'The check failed' })

const restartAnswer = ({
  status,
  updates,
}: {
  status: IDesktopUpdateStatus
  updates: IDesktopUpdatesPort
}): Response => {
  const ready =
    status.state === EDesktopUpdateState.Ready || status.web?.state === EWebPayloadState.Ready
  if (!ready) return Response.json({ message: 'No update is ready' }, { status: 409 })
  void updates.restart().catch(() => undefined)
  return new Response(null, { status: 202 })
}

export function createUpdateHandler({
  updates,
}: {
  updates: IDesktopUpdatesPort
}): (request: Request, pathname: string) => Response | Promise<Response> | undefined {
  return (request, pathname) => {
    if (pathname === UPDATE_PATH && request.method === 'GET')
      return updates.status().then((status) => Response.json(status), failed)
    if (pathname === UPDATE_CHECK_PATH && request.method === 'POST')
      return updates.check().then((status) => Response.json(status), failed)
    if (pathname === UPDATE_RESTART_PATH && request.method === 'POST')
      return updates.status().then((status) => restartAnswer({ status, updates }), failed)
    return undefined
  }
}
