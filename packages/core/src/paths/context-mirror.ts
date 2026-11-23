export const CONTEXT_MIRROR_MAX_BYTES = 10 * 1024 * 1024

export enum EContextFileKind {
  Text = 'text',
  Image = 'image',
  Binary = 'binary',
}

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

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
  if (IMAGE_EXTENSIONS.has(contextExtensionOf(args.path))) return EContextFileKind.Image
  if (args.head.includes(0)) return EContextFileKind.Binary
  return decodesAsUtf8(args.head) ? EContextFileKind.Text : EContextFileKind.Binary
}
