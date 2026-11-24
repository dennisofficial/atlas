import { dirname } from 'node:path'
import { useEffect } from 'react'

import { checkForUpdate } from '../boot/update-check'

const UPDATE_CHECK_MS = 60 * 60_000

export type UpdateCheck = (args: { home: string }) => Promise<void>

export const liveUpdateCheck: UpdateCheck = checkForUpdate

export function useUpdateCheck(args: {
  ready: boolean
  accountPath: string
  check?: UpdateCheck | undefined
}): void {
  const { ready, accountPath } = args
  const check = args.check ?? liveUpdateCheck

  useEffect(() => {
    if (!ready) return

    const home = dirname(accountPath)
    void check({ home })
    const timer = setInterval(() => void check({ home }), UPDATE_CHECK_MS)
    timer.unref?.()
    return () => clearInterval(timer)
  }, [ready, accountPath, check])
}
