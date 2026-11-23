const SESSION_PATH = /^\/sessions\/([^/]+)\/?$/

export const openSessionOf = (pathname: string): string | null => {
  const segment = SESSION_PATH.exec(pathname)?.[1]
  if (segment === undefined) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
