import { useEffect, useSyncExternalStore } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EChannelConnection, type CloudConnection } from '@dltech/atlas-harness'

import type { CloudHealth, CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import { useAttachFailure } from './attach-failure'
import { useSessionOwner } from './use-session-owner'
import { clearNotice, ENoticeTone, notify } from '../ui/notice-store'
import { CLOUD_SANDBOX_NOTICE_KEY } from './cloud/lift-notices'

const CONNECTING: CloudConnection = { state: EChannelConnection.Connecting, detail: null }

const NEVER_CHANGES = (): (() => void) => () => undefined

function useCloudState(args: { app: AtlasApp; session: CloudSession | null }): {
  location: EExecutionLocation
  bound: boolean
  threadId: ReturnType<typeof useSessionOwner>['threadId']
  failure: ReturnType<typeof useAttachFailure>
  health: CloudHealth | null
} {
  const { app, session } = args

  const { location, bound, threadId } = useSessionOwner({ app })
  const failure = useAttachFailure()
  const health = useSyncExternalStore(
    session?.subscribe ?? NEVER_CHANGES,
    () => session?.health() ?? null,
  )

  return { location, bound, threadId, failure, health }
}

/**
 * The one derivation of the cloud channel's connection for chrome: the health the session last
 * announced, gated on the placement record. A descend flips the placement before the remount that
 * drops the session, and the socket may never announce a close (`announce` fires only on change),
 * so a reader mounted in between would draw a healthy cloud from a stale Open forever — here the
 * placement is the veto, not a second subscription. Closed and Parked still surface while the
 * placement says Cloud, since those are fault and resting renderings of a session that is away.
 */
export function useCloudConnection(args: {
  app: AtlasApp
  session: CloudSession | null
}): CloudConnection | null {
  const { location, bound, threadId, failure, health } = useCloudState(args)

  if (location !== EExecutionLocation.Cloud) return null
  if (!bound) {
    if (failure !== null && failure.threadId === threadId) return { state: EChannelConnection.Closed, detail: failure.detail }
    return CONNECTING
  }
  return health?.connection ?? null
}

/**
 * The full cloud health — socket, sandbox lifecycle, and transcript freshness — for the surface
 * that decides whether the transcript on screen can be trusted as current.
 */
export function useCloudHealth(args: {
  app: AtlasApp
  session: CloudSession | null
}): CloudHealth | null {
  const { location, bound, health } = useCloudState(args)

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

  if (location !== EExecutionLocation.Cloud || !bound) return null
  return health
}
