import type { CreateThreadReply } from '@dltech/atlas-wire'

type Loose<T> = { [K in keyof T]: T[K] | undefined }

export type ThreadLaunchReply = {
  thread: Omit<Loose<CreateThreadReply['thread']>, 'forkMode'> & { forkMode?: string | undefined }
  provision: CreateThreadReply['provision']
}

export type ThreadLaunchDraft = {
  title?: string | undefined
  workspace?: string | undefined
  repo?: string | null | undefined
  projectId?: string | undefined
  model?: string | undefined
  effort?: string | undefined
}

export type ThreadLaunch = {
  userId: string
  draft: ThreadLaunchDraft
  firstMessage: { sendId: string; text: string }
}

export abstract class ThreadLauncher {
  abstract launch(args: ThreadLaunch): Promise<ThreadLaunchReply>
}
