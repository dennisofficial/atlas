export enum EContextFileKind {
  Text = 'text',
  Image = 'image',
  Binary = 'binary',
  Video = 'video',
  Audio = 'audio',
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'webm', 'mov', 'm4v'])

const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['mp3', 'wav', 'm4a', 'ogg'])

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  json: 'application/json',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'text/plain',
  ts: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
}

const NO_MIME = 'application/octet-stream'

export const contextExtensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export const contextMimeOf = (path: string): string =>
  MIME_BY_EXTENSION[contextExtensionOf(path)] ?? NO_MIME

const utf8WidthOf = (lead: number): number => {
  if (lead < 0x80) return 1
  if (lead >= 0xf0) return 4
  if (lead >= 0xe0) return 3
  if (lead >= 0xc0) return 2
  return 0
}

const textPrefixLengthOf = (head: Uint8Array): number => {
  let start = head.length
  while (start > 0 && head.length - start < 3 && (head[start - 1]! & 0xc0) === 0x80) {
    start -= 1
  }
  const lead = start === 0 ? 0 : head[start - 1]!
  if (lead >= 0xc2) {
    const width = utf8WidthOf(lead)
    return width === head.length - start + 1 ? head.length : start - 1
  }
  return head.length
}

const decodesAsUtf8 = (head: Uint8Array): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, textPrefixLengthOf(head)))
    return true
  } catch {
    return false
  }
}

export const contextFileKindOf = (args: { path: string; head: Uint8Array }): EContextFileKind => {
  const extension = contextExtensionOf(args.path)
  if (IMAGE_EXTENSIONS.has(extension)) return EContextFileKind.Image
  if (VIDEO_EXTENSIONS.has(extension)) return EContextFileKind.Video
  if (AUDIO_EXTENSIONS.has(extension)) return EContextFileKind.Audio
  if (args.head.includes(0)) return EContextFileKind.Binary
  return decodesAsUtf8(args.head) ? EContextFileKind.Text : EContextFileKind.Binary
}

const MEDIA_KINDS: ReadonlySet<EContextFileKind> = new Set([
  EContextFileKind.Image,
  EContextFileKind.Video,
  EContextFileKind.Audio,
])

export const contextMediaKindOf = (path: string): EContextFileKind | null => {
  const kind = contextFileKindOf({ path, head: new Uint8Array() })
  return MEDIA_KINDS.has(kind) ? kind : null
}
