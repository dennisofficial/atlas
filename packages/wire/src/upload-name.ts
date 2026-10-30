const MAX_NAME_LENGTH = 120
const FALLBACK_NAME = 'file'

function truncateKeepingExtension(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && name.length - dot <= 20 ? name.slice(dot) : ''
  return name.slice(0, MAX_NAME_LENGTH - extension.length) + extension
}

export function safeUploadName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const truncated = truncateKeepingExtension(cleaned).trim()
  if (truncated === '' || truncated === '.' || truncated === '..') return FALLBACK_NAME
  return truncated
}
