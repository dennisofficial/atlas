export enum EContentKind {
  Html = 'html',
  Text = 'text',
  Pdf = 'pdf',
  Image = 'image',
  Binary = 'binary',
}

const TEXTUAL_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/ecmascript',
  'application/rss+xml',
  'application/atom+xml',
  'image/svg+xml',
])

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml'])

export const essenceOf = (contentType: string): string =>
  (contentType.split(';')[0] ?? '').trim().toLowerCase()

const SNIFF_BYTES = 1024

/**
 * A server that mislabels a binary as text is caught here instead: a NUL byte does not occur in
 * decoded text, so one in the opening kilobyte means the body is not prose whatever it claimed.
 */
export const looksBinary = (bytes: Uint8Array): boolean =>
  bytes.subarray(0, SNIFF_BYTES).includes(0)

const openingOf = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes.subarray(0, SNIFF_BYTES)).trimStart().toLowerCase()

/**
 * What a body is, for the reader that turns it into text or hands it back as a file. The declared
 * type decides where it says something; the opening bytes decide where it does not, since pages
 * arrive with no type at all and a few label a binary as text.
 */
export function contentKindOf(args: { contentType: string; bytes: Uint8Array }): EContentKind {
  const essence = essenceOf(args.contentType)
  const head = openingOf(args.bytes)

  if (essence.length === 0) {
    if (head.startsWith('%pdf-')) return EContentKind.Pdf
    if (looksBinary(args.bytes)) return EContentKind.Binary
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return EContentKind.Html
    return EContentKind.Text
  }

  if (HTML_TYPES.has(essence)) return EContentKind.Html
  if (essence === 'application/pdf') return EContentKind.Pdf
  if (essence.startsWith('image/') && essence !== 'image/svg+xml') return EContentKind.Image

  const textual =
    essence.startsWith('text/') ||
    TEXTUAL_TYPES.has(essence) ||
    essence.endsWith('+json') ||
    essence.endsWith('+xml')

  if (!textual) return EContentKind.Binary
  return looksBinary(args.bytes) ? EContentKind.Binary : EContentKind.Text
}
