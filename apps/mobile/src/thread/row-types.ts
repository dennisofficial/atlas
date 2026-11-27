import type { Attachment } from '@dltech/atlas-core'
import type { EEntryKind, ToolRun } from '@dltech/atlas-client/transcript'

import type { ENoticeTone } from './notice-fields'
import type { ToolPictureView } from './tool-pictures'

export enum ERowKind {
  Message = 'message',
  Work = 'work',
  Notice = 'notice',
  Images = 'images',
  SignIn = 'sign-in',
}

export enum EMessageAuthor {
  You = 'you',
  Atlas = 'atlas',
}

export type CommandRow = { text: string; name: string }

export type MessageRow = {
  kind: ERowKind.Message
  id: string
  author: EMessageAuthor
  at: string | undefined
  text: string
  streaming: boolean
  steer: boolean
  staged?: boolean
  attachments: readonly Attachment[]
  command?: CommandRow | undefined
  sender?: string
  senderSessionId?: string | null
}

export type SessionNameOf = (sessionId: string) => string | undefined

export type ThoughtItem = {
  kind: EEntryKind.ModelThought
  id: string
  text: string
  streaming: boolean
}

export type ToolsItem = {
  kind: EEntryKind.ToolsRan
  id: string
  run: ToolRun
  streaming: boolean
}

export type WorkItem = ThoughtItem | ToolsItem

export type WorkRow = {
  kind: ERowKind.Work
  id: string
  items: readonly WorkItem[]
  stepCount: number
  running: boolean
  elapsed: string
  startedAt: string | undefined
  endedAt: string | undefined
}

export type NoticeRow = {
  kind: ERowKind.Notice
  id: string
  at: string | undefined
  title: string
  body: string
  tone: ENoticeTone
}

export type ImagesRow = {
  kind: ERowKind.Images
  id: string
  images: readonly ToolPictureView[]
}

export type SignInRow = {
  kind: ERowKind.SignIn
  id: string
  at: string | undefined
  subject: string
  url: string
  result: 'connected' | 'failed' | undefined
  reason: string | undefined
}

export type ThreadRow = MessageRow | WorkRow | NoticeRow | ImagesRow | SignInRow
