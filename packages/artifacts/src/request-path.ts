const NUL = '\u0000'

const decode = (pathname: string): string | null => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

export function sanitizeRequestPath(pathname: string): string | null {
  const decoded = decode(pathname)
  if (decoded === null) return null
  if (decoded.includes(NUL) || decoded.includes('\\')) return null

  const segments: string[] = []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }

  if (segments.length === 0) return null
  return segments.join('/')
}
