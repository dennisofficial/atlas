import type {
  ImagePart,
  MediaPart,
  MediaRef,
  RecordEventBody,
  UserContentPart,
} from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'

import type { HostTimers } from '../ports'

export const PICTURE_STORE_TIMEOUT_MS = 15_000

export type PictureStore = {
  store(args: {
    bytes: Uint8Array
    mediaType: string
    signal: AbortSignal
  }): Promise<MediaRef | null>
}

const LOG_SOURCE = 'holder.record'

type InlineImagePart = ImagePart & { bytes: { kind: 'inline'; data: string } }

type StoreAttempt =
  | { kind: 'stored'; media: MediaRef | null }
  | { kind: 'failed'; error: unknown }
  | { kind: 'timedOut' }

const isInlineImage = (part: UserContentPart): part is InlineImagePart =>
  part.type === 'image' && part.bytes.kind === 'inline'

const asMediaPart = (args: { part: ImagePart; media: MediaRef }): MediaPart => ({
  type: 'media',
  media: args.media,
  ...(args.part.source === undefined ? {} : { source: args.part.source }),
  ...(args.part.providerOptions === undefined
    ? {}
    : { providerOptions: args.part.providerOptions }),
})

const boundedStore = async (args: {
  pictures: PictureStore
  bytes: Uint8Array
  mediaType: string
  timers: HostTimers
  timeoutMs: number
}): Promise<StoreAttempt> => {
  const controller = new AbortController()
  let timer: unknown
  const expired = new Promise<StoreAttempt>((resolve) => {
    timer = args.timers.setTimeout(() => {
      controller.abort()
      resolve({ kind: 'timedOut' })
    }, args.timeoutMs)
  })
  const attempted = args.pictures
    .store({ bytes: args.bytes, mediaType: args.mediaType, signal: controller.signal })
    .then(
      (media): StoreAttempt => ({ kind: 'stored', media }),
      (error): StoreAttempt => ({ kind: 'failed', error }),
    )
  try {
    return await Promise.race([attempted, expired])
  } finally {
    args.timers.clearTimeout(timer)
  }
}

const errorTextOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const storedPart = async (args: {
  part: UserContentPart
  pictures: PictureStore
  timers: HostTimers
  timeoutMs: number
  log?: LogPort | undefined
}): Promise<UserContentPart> => {
  if (!isInlineImage(args.part)) return args.part
  const bytes = new Uint8Array(Buffer.from(args.part.bytes.data, 'base64'))
  const attempt = await boundedStore({
    pictures: args.pictures,
    bytes,
    mediaType: args.part.mediaType,
    timers: args.timers,
    timeoutMs: args.timeoutMs,
  })
  if (attempt.kind === 'stored' && attempt.media !== null)
    return asMediaPart({ part: args.part, media: attempt.media })
  if (attempt.kind === 'stored') {
    args.log?.warn({
      source: LOG_SOURCE,
      message: 'a tool picture was refused by the store; the event keeps its inline bytes',
      data: { mediaType: args.part.mediaType, size: bytes.byteLength },
    })
    return args.part
  }
  args.log?.warn({
    source: LOG_SOURCE,
    message:
      attempt.kind === 'timedOut'
        ? 'a tool picture was not stored within its deadline; the event keeps its inline bytes'
        : 'a tool picture could not be stored; the event keeps its inline bytes',
    ...(attempt.kind === 'failed' ? { error: errorTextOf(attempt.error) } : {}),
    data: { mediaType: args.part.mediaType, size: bytes.byteLength },
  })
  return args.part
}

export const storePictures = async (args: {
  body: RecordEventBody
  pictures?: PictureStore | undefined
  timers: HostTimers
  timeoutMs?: number | undefined
  log?: LogPort | undefined
}): Promise<RecordEventBody> => {
  const pictures = args.pictures
  if (pictures === undefined) return args.body
  if (args.body.type !== 'tool-result') return args.body
  const parts = args.body.modelParts
  if (parts === undefined || parts.length === 0) return args.body
  const stored = await Promise.all(
    parts.map((part) =>
      storedPart({
        part,
        pictures,
        timers: args.timers,
        timeoutMs: args.timeoutMs ?? PICTURE_STORE_TIMEOUT_MS,
        ...(args.log === undefined ? {} : { log: args.log }),
      }),
    ),
  )
  if (stored.every((part, index) => part === parts[index])) return args.body
  return { ...args.body, modelParts: stored }
}
