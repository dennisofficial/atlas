import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SaidUpload } from '@dltech/atlas-core'
import type { SaidImageWire } from '@dltech/atlas-wire/web'

import {
  chipOf,
  fitsInline,
  hasFailed,
  inlineImagesOf,
  isUploading,
  planAttach,
  restoredAttachmentsOf,
  startedAttachment,
  toastOverLimit,
  toastUploadFailed,
  TOAST_REMOVE_FAILED,
  TOAST_TOO_MANY_FILES,
  uploadsOf,
  withFailed,
  withInline,
  withProgress,
  withReady,
  EAttachmentStatus,
  type HeldAttachment,
} from './composer-attachments'
import { isImageFile } from './composer-images'
import { discardUpload, presignUpload, putFile, type UploadHandle } from './composer-uploads-api'
import { encodeImage } from './image-encode'

export function useComposerAttachments() {
  const [held, setHeld] = useState<HeldAttachment[]>([])
  const heldRef = useRef<HeldAttachment[]>([])
  const handles = useRef(new Map<string, UploadHandle>())
  const sequence = useRef(0)

  const commit = useCallback((next: HeldAttachment[]) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  const update = useCallback(
    (change: (current: HeldAttachment[]) => HeldAttachment[]) => commit(change(heldRef.current)),
    [commit],
  )

  const inline = useCallback(
    async (args: { id: string; file: File }) => {
      sequence.current += 1
      try {
        const image: SaidImageWire = await encodeImage({
          file: args.file,
          index: sequence.current,
        })
        const present = heldRef.current.some((entry) => entry.id === args.id)
        if (present && fitsInline({ held: heldRef.current, image })) {
          update((current) => withInline({ held: current, id: args.id, image }))
        }
      } catch {
        return
      }
    },
    [update],
  )

  const upload = useCallback(
    async (args: { id: string; file: File }) => {
      try {
        const reply = await presignUpload(args.file)
        if (!heldRef.current.some((entry) => entry.id === args.id)) {
          void discardUpload(reply.upload.pathname).catch(() => undefined)
          return
        }
        const handle = putFile({
          url: reply.uploadUrl,
          file: args.file,
          onProgress: (progress) =>
            update((current) => withProgress({ held: current, id: args.id, progress })),
        })
        handles.current.set(args.id, handle)
        await handle.done
        if (!heldRef.current.some((entry) => entry.id === args.id)) {
          void discardUpload(reply.upload.pathname).catch(() => undefined)
          return
        }
        update((current) => withReady({ held: current, id: args.id, upload: reply.upload }))
      } catch {
        if (!heldRef.current.some((entry) => entry.id === args.id)) return
        update((current) => withFailed({ held: current, id: args.id }))
        toast.error(toastUploadFailed(args.file.name))
      } finally {
        handles.current.delete(args.id)
      }
    },
    [update],
  )

  const attach = useCallback(
    (files: File[]): void => {
      const plan = planAttach({ files, held: heldRef.current.length })
      for (const file of plan.oversize) toast.error(toastOverLimit(file.name))
      if (plan.droppedOverflow) toast.error(TOAST_TOO_MANY_FILES)
      if (plan.accepted.length === 0) return
      const added = plan.accepted.map((file) => ({
        file,
        entry: startedAttachment({ id: crypto.randomUUID(), file }),
      }))
      update((current) => [...current, ...added.map((item) => item.entry)])
      for (const { file, entry } of added) {
        void upload({ id: entry.id, file })
        if (isImageFile(file)) void inline({ id: entry.id, file })
      }
    },
    [update, upload, inline],
  )

  const remove = useCallback(
    (id: string) => {
      const entry = heldRef.current.find((candidate) => candidate.id === id)
      handles.current.get(id)?.abort()
      handles.current.delete(id)
      commit(heldRef.current.filter((candidate) => candidate.id !== id))
      if (entry?.status === EAttachmentStatus.Ready && entry.upload !== undefined) {
        void discardUpload(entry.upload.pathname).catch(() => undefined)
      }
    },
    [commit],
  )

  const clear = useCallback(() => {
    handles.current.clear()
    commit([])
  }, [commit])

  const restore = useCallback(
    (args: { uploads: readonly SaidUpload[]; images: readonly SaidImageWire[] }) => {
      const restored = restoredAttachmentsOf({
        ...args,
        idOf: () => crypto.randomUUID(),
      })
      if (restored.length > 0) update((current) => [...current, ...restored])
    },
    [update],
  )

  const attachments = useMemo(() => held.map(chipOf), [held])
  const uploading = isUploading(held)
  const failed = hasFailed(held)

  const checkSendable = (): boolean => {
    if (failed) toast.error(TOAST_REMOVE_FAILED)
    return !failed
  }

  return {
    uploads: uploadsOf(held),
    images: inlineImagesOf(held),
    uploading,
    attach,
    remove,
    clear,
    restore,
    checkSendable,
    composerProps: {
      attachments,
      onAttachFiles: attach,
      onRemoveAttachment: remove,
    },
  }
}
