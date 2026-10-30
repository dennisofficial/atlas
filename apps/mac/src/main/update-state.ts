import { EDesktopUpdateState, type IDesktopUpdateStatus } from '../host/update-routes'

export function createUpdateState(): {
  status: () => IDesktopUpdateStatus
  markReady: (args: { version: string }) => void
} {
  let current: IDesktopUpdateStatus = { state: EDesktopUpdateState.Idle }
  return {
    status: () => current,
    markReady: ({ version }) => {
      current =
        version.length > 0
          ? { state: EDesktopUpdateState.Ready, version }
          : { state: EDesktopUpdateState.Ready }
    },
  }
}
