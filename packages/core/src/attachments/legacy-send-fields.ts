import { inlineImagesOf } from './inline-images'
import type { SaidImage, SaidUpload } from './legacy-said'
import { uploadsOf } from './uploads-of'
import type { Attachment } from './attachment'

export type LegacySaidFields = { images?: SaidImage[]; uploads?: SaidUpload[] }

/**
 * A serve that predates the `attachments` send field (#2041) strips the unknown field without a
 * word and commits the message with its pictures gone. Until the pod advertises
 * `ECapability.Attachments` the same bytes ride along in the legacy shape the old serve reads;
 * a current serve prefers `attachments` and never sees them twice.
 */
export function legacySaidFieldsOf(args: { attachments: readonly Attachment[] }): LegacySaidFields {
  const images = inlineImagesOf(args.attachments)
  const uploads = uploadsOf(args.attachments)
  return {
    ...(images.length === 0 ? {} : { images }),
    ...(uploads.length === 0 ? {} : { uploads }),
  }
}
