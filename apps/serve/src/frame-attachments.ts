import { attachmentSchema, type Attachment } from '@dltech/atlas-core'
import { z } from 'zod'

const attachmentsSchema = z.array(attachmentSchema)

export function frameAttachmentsOf(raw: readonly unknown[] | undefined): Attachment[] | undefined {
  if (raw === undefined) return undefined
  return attachmentsSchema.parse(raw)
}
