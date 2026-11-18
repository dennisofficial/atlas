import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { TOAST_TOO_MANY_FILES } from '@/features/threads/data/composer-attachments'
import type { useComposerAttachments } from '@/features/threads/data/use-composer-attachments'

import type { Attachment } from '@dltech/atlas-core'

import { routeAttachments } from './session-attachments'
import { restorePlanOf } from './session-rewind'
import { useSessionMedia } from './use-session-media'

export function useSessionAttachments({
  files,
}: {
  files: ReturnType<typeof useComposerAttachments>
}) {
  const attachAsFile = useCallback((file: File) => files.attach([file]), [files.attach])
  const media = useSessionMedia({ onUnreadable: attachAsFile })
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

  const restore = useCallback(
    (args: {
      attachments: readonly Attachment[]
      previewOf: (hash: string) => Promise<string>
    }) => {
      const plan = restorePlanOf(args.attachments)
      media.restore({ media: plan.media, previewOf: args.previewOf })
      files.restore({ uploads: plan.uploads, images: plan.images })
    },
    [media.restore, files.restore],
  )

  const attachments = useMemo(() => [...mediaChips, ...fileChips], [mediaChips, fileChips])

  const checkSendable = (): boolean => media.checkSendable() && files.checkSendable()

  return {
    media: media.media,
    uploads: files.uploads,
    uploading: media.uploading || files.uploading,
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
