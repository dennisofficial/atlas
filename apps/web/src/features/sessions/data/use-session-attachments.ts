import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { TOAST_TOO_MANY_FILES } from '@/features/threads/data/composer-attachments'
import type { useComposerAttachments } from '@/features/threads/data/use-composer-attachments'

import { routeAttachments } from './session-attachments'
import { useSessionMedia } from './use-session-media'

export function useSessionAttachments({
  files,
}: {
  files: ReturnType<typeof useComposerAttachments>
}) {
  const media = useSessionMedia()
  const mediaChips = media.composerProps.attachments
  const fileChips = files.composerProps.attachments
  const heldCount = mediaChips.length + fileChips.length

  const attach = useCallback(
    (picked: File[]): void => {
      const routed = routeAttachments({ files: picked, held: heldCount })
      if (routed.droppedOverflow) toast.error(TOAST_TOO_MANY_FILES)
      if (routed.images.length > 0) media.attach(routed.images)
      if (routed.others.length > 0) files.attach(routed.others)
    },
    [heldCount, media.attach, files.attach],
  )

  const remove = useCallback(
    (id: string) => {
      media.remove(id)
      files.remove(id)
    },
    [media.remove, files.remove],
  )

  const clear = useCallback(() => {
    media.clear()
    files.clear()
  }, [media.clear, files.clear])

  const attachments = useMemo(() => [...mediaChips, ...fileChips], [mediaChips, fileChips])

  const checkSendable = (): boolean => media.checkSendable() && files.checkSendable()

  return {
    media: media.media,
    uploads: files.uploads,
    uploading: media.uploading || files.uploading,
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
