import { useMemo } from 'react'

import { attachmentsOf, type Attachment, type SaidUpload } from '@dltech/atlas-core'

const identitiesOf = (args: {
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): string =>
  [
    ...args.media.map((attachment) => attachment.id),
    ...args.uploads.map((upload) => upload.uploadId),
  ].join('\u0000')

export function useDraftAttachments(args: {
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): readonly Attachment[] {
  const { media, uploads } = args
  const identities = identitiesOf(args)
  return useMemo(() => [...media, ...attachmentsOf({ uploads })], [identities])
}
