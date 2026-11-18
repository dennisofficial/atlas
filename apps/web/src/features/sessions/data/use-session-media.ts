import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { decodeBase64 } from '@dltech/atlas-core'

import {
  TOAST_REMOVE_FAILED,
  TOAST_TOO_MANY_FILES,
  toastOverLimit,
  toastUploadFailed,
} from '@/features/threads/data/composer-attachments'
import { putFile, type UploadHandle } from '@/features/threads/data/composer-uploads-api'
import { encodeImage } from '@/features/threads/data/image-encode'
import { api, cloudCall } from '@/lib/api-client'

import {
  hasMediaFailed,
  isMediaUploading,
  mediaChipOf,
  planImageAttach,
  readyAttachmentsOf,
  startedMedia,
  storeImage,
  supportedMediaTypeOf,
  TOAST_IMAGES_ONLY,
  withMediaEncoded,
  withMediaFailed,
  withMediaProgress,
  withMediaReady,
  type HeldMedia,
  type MediaUploadApi,
} from './session-media'

const mediaApi: MediaUploadApi = {
  presign: (input) => cloudCall(api.media.presign.mutate(input)),
  confirm: (input) => cloudCall(api.media.confirm.mutate(input)),
}

export function useSessionMedia({
  onUnreadable,
}: {
  onUnreadable?: ((file: File) => void) | undefined
} = {}) {
  const [held, setHeld] = useState<HeldMedia[]>([])
  const heldRef = useRef<HeldMedia[]>([])
  const handles = useRef(new Map<string, UploadHandle>())
  const sequence = useRef(0)

  const commit = useCallback((next: HeldMedia[]) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  const update = useCallback(
    (change: (current: HeldMedia[]) => HeldMedia[]) => commit(change(heldRef.current)),
    [commit],
  )

  const isHeld = useCallback((id: string) => heldRef.current.some((entry) => entry.id === id), [])

  const remove = useCallback(
    (id: string) => {
      handles.current.get(id)?.abort()
      handles.current.delete(id)
      commit(heldRef.current.filter((entry) => entry.id !== id))
    },
    [commit],
  )

  const fail = useCallback(
    (args: { id: string; file: File }) => {
      update((current) => withMediaFailed({ held: current, id: args.id }))
      toast.error(toastUploadFailed(args.file.name))
    },
    [update],
  )

  const process = useCallback(
    async (args: { id: string; file: File }) => {
      const { id } = args
      sequence.current += 1
      const image = await encodeImage({ file: args.file, index: sequence.current }).catch(
        () => null,
      )
      if (image === null) {
        if (!isHeld(id)) return
        if (onUnreadable === undefined) {
          fail({ id, file: args.file })
          return
        }
        remove(id)
        onUnreadable(args.file)
        return
      }
      try {
        update((current) =>
          withMediaEncoded({
            held: current,
            id,
            name: image.path,
            previewUrl: `data:${image.mediaType};base64,${image.data}`,
            mediaType: image.mediaType,
            size: decodeBase64(image.data).byteLength,
          }),
        )
        const hash = await storeImage({
          bytes: decodeBase64(image.data),
          mediaType: supportedMediaTypeOf(image.mediaType),
          api: mediaApi,
          put: putFile,
          onProgress: (progress) =>
            update((current) => withMediaProgress({ held: current, id, progress })),
          onHandle: (handle) => handles.current.set(id, handle),
        })
        if (!isHeld(id)) return
        update((current) => withMediaReady({ held: current, id, hash }))
      } catch {
        if (!isHeld(id)) return
        fail({ id, file: args.file })
      } finally {
        handles.current.delete(id)
      }
    },
    [fail, isHeld, onUnreadable, remove, update],
  )

  const attach = useCallback(
    (files: File[]): void => {
      const plan = planImageAttach({ files, held: heldRef.current.length })
      if (plan.rejected.length > 0) toast.error(TOAST_IMAGES_ONLY)
      for (const file of plan.oversize) toast.error(toastOverLimit(file.name))
      if (plan.droppedOverflow) toast.error(TOAST_TOO_MANY_FILES)
      if (plan.accepted.length === 0) return
      const added = plan.accepted.map((file) => ({
        file,
        entry: startedMedia({ id: crypto.randomUUID(), file }),
      }))
      update((current) => [...current, ...added.map((item) => item.entry)])
      for (const { file, entry } of added) void process({ id: entry.id, file })
    },
    [update, process],
  )

  const clear = useCallback(() => {
    handles.current.clear()
    commit([])
  }, [commit])

  const attachments = useMemo(() => held.map(mediaChipOf), [held])
  const failed = hasMediaFailed(held)

  const checkSendable = (): boolean => {
    if (failed) toast.error(TOAST_REMOVE_FAILED)
    return !failed
  }

  return {
    media: readyAttachmentsOf(held),
    uploading: isMediaUploading(held),
    attach,
    remove,
    clear,
    checkSendable,
    composerProps: {
      attachments,
      onAttachFiles: attach,
      onRemoveAttachment: remove,
    },
  }
}
