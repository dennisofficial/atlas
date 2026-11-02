import { EDesktopUpdateState, type IDesktopUpdateStatus } from '../host/update-routes'

export interface IUpdateState {
  status: () => IDesktopUpdateStatus
  markReady: (args: { version: string }) => void
  markRestarting: () => void
  markFailed: (args: { message: string }) => void
}

function statusOf({
  state,
  version,
  error,
}: {
  state: EDesktopUpdateState
  version: string | undefined
  error?: string
}): IDesktopUpdateStatus {
  return {
    state,
    ...(version === undefined ? {} : { version }),
    ...(error === undefined ? {} : { error }),
  }
}

export function createUpdateState(): IUpdateState {
  let version: string | undefined
  let current: IDesktopUpdateStatus = { state: EDesktopUpdateState.Idle }
  return {
    status: () => current,
    markReady: ({ version: next }) => {
      if (current.state === EDesktopUpdateState.Restarting) return
      version = next.length > 0 ? next : undefined
      current = statusOf({ state: EDesktopUpdateState.Ready, version })
    },
    markRestarting: () => {
      current = statusOf({ state: EDesktopUpdateState.Restarting, version })
    },
    markFailed: ({ message }) => {
      current = statusOf({ state: EDesktopUpdateState.Ready, version, error: message })
    },
  }
}
