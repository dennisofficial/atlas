import type { ENoticeTone } from '../notices/notice'

/** What a composition root reports about the app rather than in the conversation. */
export type NoticePost = {
  readonly text: string
  readonly tone: ENoticeTone
  /** The producer's identity: reposting a key replaces the standing notice rather than stacking. */
  readonly key?: string | undefined
  /** Absent falls to the surface's default; null is sticky. */
  readonly ttlMs?: number | null | undefined
}

export abstract class NoticePort {
  abstract notify(post: NoticePost): void
}
