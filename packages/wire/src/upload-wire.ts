import { z } from 'zod'

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_MESSAGE_UPLOADS = 20

export const saidUploadWireSchema = z.object({
  uploadId: z.uuid(),
  pathname: z.string().max(500),
  name: z.string().min(1).max(200),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  mediaType: z.string().max(200),
})

export type SaidUploadWire = z.infer<typeof saidUploadWireSchema>
