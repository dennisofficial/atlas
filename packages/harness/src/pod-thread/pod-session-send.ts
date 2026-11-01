import { ENoticeTone, NOTICE_WARN_MS, type NoticePort, type ThreadId } from '@dltech/atlas-core'

import type { CloudMessages } from '../cloud/cloud-bridge'
import { EConnectionView } from '../cloud/connection-view'
import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { podFailureReasonOf } from './pod-failure'
import type { PodSessionChannel } from './pod-session'

export const POD_SEND_FAILED_NOTICE_KEY = 'cloud-send-failed'

/**
 * A send recorded as durable intent with the pod's control plane (the API's threadMessages lane).
 * The pod pulls it on boot or on signal; `files` have no API lane (local paths a fresh pod cannot
 * read) and never ride this path. Fire-and-forget: a failure lands as a notice, and the composer
 * keeps its own sending row as the in-flight truth.
 */
export type PodSessionSend = (args: {
  text: string
  images?: Parameters<CloudMessages['send']>[0]['images']
  uploads?: Parameters<CloudMessages['send']>[0]['uploads']
}) => void

/** Provisioning the pod is how the session learns whether the thread has a cloud control plane. */
export type PodProvisionProbe = {
  threadSandbox: {
    provision: { mutate(input: { threadId: ThreadId }): Promise<{ state: ESandboxProvisionState }> }
  }
}

const sendFailureOf = (error: unknown): string =>
  `the message could not be queued with the cloud — ${podFailureReasonOf(error)}`

export function createPodSessionSend(args: {
  channel: Pick<PodSessionChannel, 'threadId' | 'connection'>
  messages: CloudMessages
  api?: PodProvisionProbe | undefined
  wake: () => void
  notice: NoticePort
  closed: () => boolean
}): PodSessionSend {
  const { channel, messages, api, wake, notice, closed } = args

  let apiLane: Promise<boolean> | null = null
  const hasApiLane = (): Promise<boolean> => {
    if (api === undefined) return Promise.resolve(false)
    apiLane ??= api.threadSandbox.provision
      .mutate({ threadId: channel.threadId })
      .then((reply) => reply.state !== ESandboxProvisionState.NotConfigured)
      .catch(() => false)
    return apiLane
  }

  /**
   * A parked/waking send goes to the API so the intent is durable and the wake claim fires
   * there; the pod pulls the message on boot or on signal. Threads the API refuses (BYO pods)
   * fall back to the old ceremony: wake here, and the caller's channel frame carries the
   * message once connected.
   */
  return (sendArgs) => {
    if (closed()) return
    void (async () => {
      if (!(await hasApiLane())) {
        wake()
        return false
      }
      try {
        await messages.send({
          threadId: channel.threadId,
          sendId: crypto.randomUUID(),
          ...sendArgs,
        })
        return true
      } catch (error) {
        if (!closed())
          notice.notify({
            key: POD_SEND_FAILED_NOTICE_KEY,
            text: sendFailureOf(error),
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
        return false
      }
    })().then((queuedWithApi) => {
      if (!queuedWithApi || closed()) return
      const state = channel.connection().state
      if (state === EConnectionView.Connected || state === EConnectionView.Detached) return
      wake()
    })
  }
}
