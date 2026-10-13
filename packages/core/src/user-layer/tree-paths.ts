const MAX_TREE_PATH_LENGTH = 500
const DRIVE_LETTER = /^[a-zA-Z]:/
const DUPLICATE_SLASHES = /\/{2,}/g
const LEADING_DOT_SLASH = /^(\.\/)+/

const isValidSegment = (segment: string): boolean =>
  segment !== '' && segment !== '.' && segment !== '..' && segment === segment.trim()

export function isValidTreePath(path: string): boolean {
  if (path === '' || path.length > MAX_TREE_PATH_LENGTH) return false
  if (path.startsWith('/') || DRIVE_LETTER.test(path)) return false
  if (path.includes('\\') || path.includes('\0')) return false
  return path.split('/').every(isValidSegment)
}

export function normalizeTreePath(path: string): string {
  return path.replace(DUPLICATE_SLASHES, '/').replace(LEADING_DOT_SLASH, '')
}
