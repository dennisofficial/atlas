import type { PickedFile } from './attachment-plan'

const MEDIA_TYPE_OF_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  tiff: 'image/tiff',
}

const FALLBACK_EXTENSION = 'png'

const extensionOf = (uri: string): string => {
  const path = uri.split(/[?#]/)[0] ?? ''
  const dot = path.lastIndexOf('.')
  const extension = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  return extension in MEDIA_TYPE_OF_EXTENSION ? extension : FALLBACK_EXTENSION
}

export const pastedFileOf = (args: { uri: string; at: number; index: number }): PickedFile => {
  const extension = extensionOf(args.uri)
  const suffix = args.index === 0 ? '' : `-${args.index + 1}`
  return {
    name: `pasted-${args.at}${suffix}.${extension === 'jpeg' ? 'jpg' : extension}`,
    size: 0,
    mediaType: MEDIA_TYPE_OF_EXTENSION[extension] ?? 'image/png',
    uri: args.uri,
  }
}
