import type { ApiClient } from '@dltech/atlas-api-router'
import type { CreateThreadReply, WireThread } from '@dltech/atlas-wire/web'

const isReply = (value: WireThread | CreateThreadReply): value is CreateThreadReply =>
  'thread' in value && 'provision' in value

export const createSession = async ({
  api,
  projectId,
  text,
  sendId,
}: {
  api: ApiClient
  projectId: string
  text: string
  sendId: string
}): Promise<string> => {
  const created = await api.threads.create.mutate({
    projectId,
    firstMessage: { sendId, text },
  })
  return isReply(created) ? created.thread.id : created.id
}
