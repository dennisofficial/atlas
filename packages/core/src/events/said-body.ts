import type { SaidFile, SaidImage } from './body'

export type SaidBody = {
  type: 'user-said'
  text: string
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
}

/**
 * Every producer of a user-said body omits an empty attachments list rather than stamping `[]`,
 * so the stored event stays minimal and the schema never has to read an empty array back.
 */
export function saidBody(args: {
  text: string
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
}): SaidBody {
  const hasImages = args.images !== undefined && args.images.length > 0
  const hasFiles = args.files !== undefined && args.files.length > 0

  return {
    type: 'user-said',
    text: args.text,
    ...(hasImages ? { images: args.images } : {}),
    ...(hasFiles ? { files: args.files } : {}),
  }
}
