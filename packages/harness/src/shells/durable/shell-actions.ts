import type { ChildProcess } from 'node:child_process'

import { signalGroup } from './child'
import type { ShellActions } from './control-server'
import {
  EControlError,
  EExitCause,
  INPUT_BUFFER_BUDGET_BYTES,
  INPUT_WRITE_MAX_BYTES,
  type ControlResult,
} from './protocol'

const INPUT_WRITE_WAIT_MS = 1_000

const refuse = (code: EControlError, message: string): ControlResult => ({ ok: false, code, message })

export function createShellActions({
  child,
  pgid,
  touch,
  isExited,
  requestStop,
  requestKill,
}: {
  child: ChildProcess
  pgid: number
  touch: () => void
  isExited: () => boolean
  requestStop: (cause: EExitCause) => void
  requestKill: (cause: EExitCause) => void
}): ShellActions {
  let stdinOpen = true
  let inFlightInputBytes = 0
  child.stdin?.on('error', () => {
    stdinOpen = false
  })
  child.stdin?.on('close', () => {
    stdinOpen = false
  })

  const guarded = (run: () => ControlResult): ControlResult =>
    isExited() ? refuse(EControlError.AlreadyExited, 'the shell has exited') : run()

  return {
    touch,
    input: async ({ data }) => {
      const stdin = child.stdin
      if (isExited()) return refuse(EControlError.AlreadyExited, 'the shell has exited')
      if (!stdinOpen || stdin === null) return refuse(EControlError.InputClosed, 'stdin is closed')
      if (data.length > INPUT_WRITE_MAX_BYTES) return refuse(EControlError.InputTooLarge, 'input chunk too large')
      if (inFlightInputBytes + data.length > INPUT_BUFFER_BUDGET_BYTES)
        return refuse(
          EControlError.InputBackpressure,
          `${INPUT_BUFFER_BUDGET_BYTES} bytes of input are queued and unread; the shell is not reading its input`,
        )
      inFlightInputBytes += data.length
      return new Promise<ControlResult>((resolve) => {
        const timer = setTimeout(
          () =>
            resolve(
              refuse(
                EControlError.InputBackpressure,
                'the shell has not read this input yet; it stays queued and may still be delivered later',
              ),
            ),
          INPUT_WRITE_WAIT_MS,
        )
        stdin.write(data, (error) => {
          inFlightInputBytes -= data.length
          clearTimeout(timer)
          resolve(error ? refuse(EControlError.InputClosed, `stdin rejected the input: ${error.message}`) : { ok: true })
        })
      })
    },
    closeInput: () =>
      guarded(() => {
        if (stdinOpen) child.stdin?.end()
        stdinOpen = false
        return { ok: true }
      }),
    signal: ({ signal }) =>
      guarded(() =>
        signalGroup({ pgid, signal }) ? { ok: true } : refuse(EControlError.AlreadyExited, 'no process group'),
      ),
    terminate: () =>
      guarded(() => {
        requestStop(EExitCause.Terminated)
        return { ok: true }
      }),
    kill: () =>
      guarded(() => {
        requestKill(EExitCause.Killed)
        return { ok: true }
      }),
  }
}
