import { useCallback, useMemo, useRef, useState } from 'react'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import {
  MAX_INLINE_BYTES,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  type Attachment,
  type SaidUpload,
} from '@dltech/atlas-core'
import { storeImage, supportedMediaTypeOf } from '@dltech/atlas-client/session'

import type { ClipboardImage } from '../ui/clipboard-image'
import type { SessionApi } from './session-api'
import { putBytes, putImageOf } from './upload-put'

export type HeldAttachment = {
  id: string
  path: string
  name: string
  mediaType: string
  byteLength: number
  status: 'uploading' | 'ready' | 'failed'
  media?: { hash: string } | undefined
  upload?: SaidUpload | undefined
}

export type AttachmentPayload = {
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}

export type SessionAttachments = {
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
  payload: () => AttachmentPayload
  uploading: boolean
  held: readonly HeldAttachment[]
  attachImages: (images: readonly ClipboardImage[]) => void
  remove: (id: string) => void
  retain: (paths: readonly string[]) => void
  clear: () => void
  sent: () => void
  checkSendable: () => boolean
}

const inlineableOf = (image: ClipboardImage): boolean =>
  image.byteLength <= MAX_INLINE_BYTES &&
  SUPPORTED_IMAGE_MEDIA_TYPES.some((type) => type === image.mediaType)

const attachmentsOfHeld = (held: readonly HeldAttachment[]): readonly Attachment[] =>
  held.flatMap((entry) => {
    if (entry.status !== 'ready' || entry.media === undefined) return []
    return [
      {
        id: `media:${entry.media.hash}`,
        name: entry.name,
        mediaType: entry.mediaType,
        size: entry.byteLength,
        content: { store: 'media', hash: entry.media.hash },
      } satisfies Attachment,
    ]
  })

export function useSessionAttachments(args: {
  api: SessionApi
  sessionId: string
  onProblem: (reason: string) => void
}): SessionAttachments {
  const [held, setHeld] = useState<readonly HeldAttachment[]>([])
  const heldRef = useRef<readonly HeldAttachment[]>(held)
  heldRef.current = held
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  const update = useCallback((change: (current: readonly HeldAttachment[]) => HeldAttachment[]) => {
    const next = change(heldRef.current)
    heldRef.current = next
    setHeld(next)
  }, [])

  const patch = useCallback(
    (id: string, fields: Partial<HeldAttachment>) => {
      update((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry)),
      )
    },
    [update],
  )

  const storeMedia = useCallback(
    async (entry: HeldAttachment, image: ClipboardImage, bytes: Uint8Array) => {
      const hash = await storeImage({
        bytes,
        mediaType: supportedMediaTypeOf(image.mediaType),
        api: { presign: args.api.presignMedia, confirm: args.api.confirmMedia },
        put: putImageOf(putBytes),
        onProgress: () => undefined,
        onHandle: () => undefined,
      })
      patch(entry.id, { status: 'ready', media: { hash } })
    },
    [args.api, patch],
  )

  const storeUpload = useCallback(
    async (entry: HeldAttachment, image: ClipboardImage, bytes: Uint8Array) => {
      const presigned = await args.api.presignUpload({
        name: basename(image.path),
        size: image.byteLength,
        mediaType: image.mediaType,
      })
      await putBytes({
        url: presigned.uploadUrl,
        bytes,
        mediaType: image.mediaType,
        onProgress: () => undefined,
      }).done
      patch(entry.id, { status: 'ready', upload: presigned.upload })
    },
    [args.api, patch],
  )

  const attachOne = useCallback(
    (image: ClipboardImage) => {
      const entry: HeldAttachment = {
        id: crypto.randomUUID(),
        path: image.path,
        name: basename(image.path),
        mediaType: image.mediaType,
        byteLength: image.byteLength,
        status: 'uploading',
      }

      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(readFileSync(image.path))
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message : String(failure)
        problem.current(`could not attach ${entry.name}: ${reason}`)
        return
      }

      update((current) => [...current, entry])

      const run = inlineableOf(image) ? storeMedia : storeUpload
      void run(entry, image, bytes).catch((failure: unknown) => {
        const reason = failure instanceof Error ? failure.message : String(failure)
        patch(entry.id, { status: 'failed' })
        problem.current(`could not attach ${entry.name}: ${reason}`)
      })
    },
    [patch, storeMedia, storeUpload, update],
  )

  const attachImages = useCallback(
    (images: readonly ClipboardImage[]) => {
      for (const image of images) attachOne(image)
    },
    [attachOne],
  )

  const remove = useCallback(
    (id: string) => {
      const entry = heldRef.current.find((candidate) => candidate.id === id)
      update((current) => current.filter((candidate) => candidate.id !== id))
      if (entry?.upload !== undefined && entry.status === 'ready') {
        void args.api.discardUpload(entry.upload.pathname).catch(() => undefined)
      }
    },
    [args.api, update],
  )

  const retain = useCallback(
    (paths: readonly string[]) => {
      const keep = new Set(paths)
      const dropped = heldRef.current.filter((entry) => !keep.has(entry.path))
      if (dropped.length === 0) return
      update((current) => current.filter((entry) => keep.has(entry.path)))
      for (const entry of dropped) {
        if (entry.status !== 'ready' || entry.upload === undefined) continue
        void args.api.discardUpload(entry.upload.pathname).catch(() => undefined)
      }
    },
    [args.api, update],
  )

  const clear = useCallback(() => {
    for (const entry of heldRef.current) {
      if (entry.upload === undefined) continue
      void args.api.discardUpload(entry.upload.pathname).catch(() => undefined)
    }
    update(() => [])
  }, [args.api, update])

  const payload = useCallback(
    (): AttachmentPayload => ({
      media: attachmentsOfHeld(heldRef.current),
      uploads: heldRef.current.flatMap((entry) => entry.upload ?? []),
    }),
    [],
  )

  const sent = useCallback(() => {
    update(() => [])
  }, [update])

  const checkSendable = useCallback(
    (): boolean => heldRef.current.every((entry) => entry.status === 'ready'),
    [],
  )

  const media = useMemo(() => attachmentsOfHeld(held), [held])
  const uploads = useMemo(() => held.flatMap((entry) => entry.upload ?? []), [held])
  const uploading = useMemo(() => held.some((entry) => entry.status === 'uploading'), [held])

  return {
    media,
    uploads,
    payload,
    uploading,
    held,
    attachImages,
    remove,
    retain,
    clear,
    sent,
    checkSendable,
  }
}
