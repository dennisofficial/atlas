import { ENoticeTone, type NoticePort, type ThreadId } from '@dltech/atlas-core'
import { SessionsClient } from '@dltech/atlas-harness'
import { writesBehind } from '@dltech/atlas-wire'

export type ThreadModelPersister = (model: { ref: string; effort: string }) => Promise<void>

export function threadModelPersisterOf(args: {
  env: Record<string, string | undefined>
  threadId: ThreadId
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  notice: NoticePort
}): ThreadModelPersister | undefined {
  if (!writesBehind(args.env)) return undefined
  const client = new SessionsClient({
    url: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })
  return async (model) => {
    try {
      await client.chooseThreadModel({ threadId: args.threadId, ...model })
    } catch (failure) {
      args.notice.notify({
        tone: ENoticeTone.Warn,
        key: 'thread-model-persist',
        text: `could not save the thread model to the API: ${failure instanceof Error ? failure.message : String(failure)}`,
      })
      throw failure
    }
  }
}
