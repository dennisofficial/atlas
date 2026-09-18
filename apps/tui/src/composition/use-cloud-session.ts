import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { clearNotice, ENoticeTone, notify } from '../ui/notice-store'
import type { CloudHealth, CloudSession } from './cloud/cloud-session'
import { CLOUD_SANDBOX_NOTICE_KEY } from './cloud/lift-notices'

const NEVER_CHANGES = (): (() => void) => () => undefined

const NOT_ATTACHED = null

export function useCloudSession(args: { session: CloudSession | null }): CloudHealth | null {
  const { session } = args

  const subscribe = session?.subscribe ?? NEVER_CHANGES
  const read = useCallback((): CloudHealth | null => session?.health() ?? NOT_ATTACHED, [session])

  const health = useSyncExternalStore(subscribe, read)

  /**
   * Whatever the sandbox last refused in its own words — a workspace that would not materialise
   * says which git step failed and what git said. It stands until it is superseded, because talking
   * to an agent in an empty directory is the failure this is here to prevent.
   */
  const failure = health?.failure ?? null
  useEffect(() => {
    if (failure === null) {
      clearNotice({ key: CLOUD_SANDBOX_NOTICE_KEY })
      return
    }

    notify({
      key: CLOUD_SANDBOX_NOTICE_KEY,
      text: failure,
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [failure])

  return health
}
