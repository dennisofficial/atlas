import { ENoticeTone, type NoticePort, type ThreadId } from '@dltech/atlas-core'
import { SessionsClient } from '@dltech/atlas-harness'
import { isApiProvisioned } from '@dltech/atlas-wire'

export type BootModel = { ref: string; effort?: string | undefined }

export async function apiThreadModel(args: {
  env: Record<string, string | undefined>
  threadId: ThreadId
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  notice: NoticePort
}): Promise<BootModel | undefined> {
  if (!isApiProvisioned(args.env)) return undefined
  try {
    const thread = await new SessionsClient({
      url: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
    }).findThread({ threadId: args.threadId })
    return thread?.model
  } catch (failure) {
    args.notice.notify({
      tone: ENoticeTone.Warn,
      key: 'thread-model-read',
      text: `could not read the thread model from the API: ${failure instanceof Error ? failure.message : String(failure)}`,
    })
    return undefined
  }
}
