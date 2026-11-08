import type { Attachment } from '@dltech/atlas-core'
import { MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'
import * as DocumentPicker from 'expo-document-picker'
import { randomUUID } from 'expo-crypto'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import {
  attachmentsOf,
  EAttachmentStatus,
  hasFailed,
  isUploading,
  OCTET_STREAM,
  planAttach,
  startedAttachment,
  TOO_MANY_FILES,
  tooLargeNotice,
  uploadFailedNotice,
  withFailed,
  withProgress,
  withReady,
  withoutAttachment,
  type HeldAttachment,
  type PickedFile,
} from './attachment-plan'
import { putBytes, sizeOfFile, type UploadHandle } from './put-bytes'

export type ComposerAttachments = {
  held: readonly HeldAttachment[]
  attachments: Attachment[]
  uploading: boolean
  failed: boolean
  notice: string | null
  pickPhotos: () => Promise<void>
  pickFiles: () => Promise<void>
  remove: (id: string) => void
  clear: () => void
}

const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1] ?? 'jpeg'
  const clean = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (clean === '' || clean === 'jpeg') return 'jpg'
  return clean
}

const pickedPhoto = (asset: ImagePicker.ImagePickerAsset, index: number): PickedFile => {
  const mediaType = asset.mimeType ?? 'image/jpeg'
  return {
    name: asset.fileName ?? `photo-${Date.now()}-${index}.${extensionOf(mediaType)}`,
    size: asset.fileSize ?? asset.file?.size ?? 0,
    mediaType,
    uri: asset.uri,
    ...(asset.file === undefined ? {} : { blob: asset.file }),
  }
}

const pickedDocument = (asset: DocumentPicker.DocumentPickerAsset): PickedFile => ({
  name: asset.name,
  size: asset.size ?? asset.file?.size ?? 0,
  mediaType: asset.mimeType ?? OCTET_STREAM,
  uri: asset.uri,
  ...(asset.file === undefined ? {} : { blob: asset.file }),
})

export function useAttachments(): ComposerAttachments {
  const { api } = useAuth()
  const [held, setHeld] = useState<HeldAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const heldRef = useRef<HeldAttachment[]>([])
  const handles = useRef(new Map<string, UploadHandle>())

  const commit = useCallback((next: HeldAttachment[]) => {
    heldRef.current = next
    setHeld(next)
  }, [])

  const update = useCallback(
    (change: (current: HeldAttachment[]) => HeldAttachment[]) => commit(change(heldRef.current)),
    [commit],
  )

  const holds = useCallback((id: string): boolean => {
    return heldRef.current.some((entry) => entry.id === id)
  }, [])

  const discard = useCallback(
    (pathname: string) => {
      void api?.composerUploads.discard.mutate({ pathname }).catch(() => undefined)
    },
    [api],
  )

  const upload = useCallback(
    async (args: { id: string; file: PickedFile }) => {
      if (api === undefined) {
        update((current) => withFailed({ held: current, id: args.id }))
        setNotice(uploadFailedNotice(args.file.name))
        return
      }
      try {
        const size = args.file.size > 0 ? args.file.size : await sizeOfFile(args.file.uri)
        const reply = await api.composerUploads.presign.mutate({
          name: args.file.name,
          size,
          mediaType: args.file.mediaType,
        })
        if (!holds(args.id)) {
          discard(reply.upload.pathname)
          return
        }
        const handle = putBytes({
          url: reply.uploadUrl,
          uri: args.file.uri,
          mediaType: args.file.mediaType,
          ...(args.file.blob === undefined ? {} : { blob: args.file.blob }),
          onProgress: (progress) =>
            update((current) => withProgress({ held: current, id: args.id, progress })),
        })
        handles.current.set(args.id, handle)
        await handle.done
        if (!holds(args.id)) {
          discard(reply.upload.pathname)
          return
        }
        update((current) => withReady({ held: current, id: args.id, upload: reply.upload }))
      } catch {
        if (!holds(args.id)) return
        update((current) => withFailed({ held: current, id: args.id }))
        setNotice(uploadFailedNotice(args.file.name))
      } finally {
        handles.current.delete(args.id)
      }
    },
    [api, discard, holds, update],
  )

  const attach = useCallback(
    (files: PickedFile[]): void => {
      setNotice(null)
      const plan = planAttach({ files, held: heldRef.current.length })
      const notices = [
        ...plan.oversize.map((file) => tooLargeNotice(file.name)),
        ...(plan.droppedOverflow ? [TOO_MANY_FILES] : []),
      ]
      setNotice(notices[0] ?? null)
      if (plan.accepted.length === 0) return
      const added = plan.accepted.map((file) => ({
        file,
        entry: startedAttachment({ id: randomUUID(), file }),
      }))
      update((current) => [...current, ...added.map((item) => item.entry)])
      for (const item of added) void upload({ id: item.entry.id, file: item.file })
    },
    [update, upload],
  )

  const pickPhotos = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_MESSAGE_UPLOADS,
      quality: 1,
    })
    if (result.canceled) return
    attach(result.assets.map(pickedPhoto))
  }, [attach])

  const pickFiles = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    })
    if (result.canceled) return
    attach(result.assets.map(pickedDocument))
  }, [attach])

  const remove = useCallback(
    (id: string) => {
      const entry = heldRef.current.find((candidate) => candidate.id === id)
      handles.current.get(id)?.abort()
      handles.current.delete(id)
      commit(withoutAttachment({ held: heldRef.current, id }))
      if (entry?.status === EAttachmentStatus.Ready && entry.upload !== undefined)
        discard(entry.upload.pathname)
    },
    [commit, discard],
  )

  const clear = useCallback(() => {
    for (const handle of handles.current.values()) handle.abort()
    handles.current.clear()
    setNotice(null)
    commit([])
  }, [commit])

  const attachments = useMemo(() => attachmentsOf(held), [held])

  return {
    held,
    attachments,
    uploading: isUploading(held),
    failed: hasFailed(held),
    notice,
    pickPhotos,
    pickFiles,
    remove,
    clear,
  }
}
