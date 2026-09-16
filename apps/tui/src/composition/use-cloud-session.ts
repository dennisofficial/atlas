import { EChannelConnection } from '@dltech/atlas-harness'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { clearNotice, ENoticeTone, notify } from '../ui/notice-store'
import type { CloudConnection } from './cloud/cloud-bridge'
import type { CloudHealth, CloudSession } from './cloud/cloud-session'
import {
  CLOUD_CONNECTION_NOTICE_KEY,
  CLOUD_SANDBOX_NOTICE_KEY,
  connectionNotice,
} from './cloud/lift-notices'

const NEVER_CHANGES = (): (() => void) => () => undefined

const NOT_ATTACHED = null

/**
 * Parked and reconnecting are resting states, not faults: the sandbox is stopped between bursts of
 * work and the next message wakes it. Only a socket the control plane cannot account for is warned
 * about.
 */
const toneOf = (connection: CloudConnection): ENoticeTone =>
  connection.state === EChannelConnection.Closed ? ENoticeTone.Warn : ENoticeTone.Info

export function useCloudSession(args: { session: CloudSession | null }): CloudHealth | null {
  const { session } = args

  const subscribe = session?.subscribe ?? NEVER_CHANGES
  const read = useCallback((): CloudHealth | null => session?.health() ?? NOT_ATTACHED, [session])

  const health = useSyncExternalStore(subscribe, read)

  const connection = health?.connection ?? null
  useEffect(() => {
    if (connection === null) {
      clearNotice({ key: CLOUD_CONNECTION_NOTICE_KEY })
      return
    }

    const text = connectionNotice(connection)
    if (text === null) {
      clearNotice({ key: CLOUD_CONNECTION_NOTICE_KEY })
      return
    }

    notify({
      key: CLOUD_CONNECTION_NOTICE_KEY,
      text,
      tone: toneOf(connection),
      sticky: true,
    })
  }, [connection])

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
