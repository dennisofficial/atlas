import type { ImagePart } from './parts'

export const inlineImageData = (part: ImagePart): string | undefined =>
  part.bytes.kind === 'inline' ? part.bytes.data : undefined

export const inlineImagePart = ({
  data,
  mediaType,
  ...rest
}: { data: string; mediaType: string } & Omit<
  ImagePart,
  'type' | 'bytes' | 'mediaType'
>): ImagePart => ({ type: 'image', bytes: { kind: 'inline', data }, mediaType, ...rest })
