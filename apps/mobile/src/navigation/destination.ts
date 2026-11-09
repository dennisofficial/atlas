export type TDestination =
  | { pathname: '/sessions/[id]'; params: { id: string } }
  | { pathname: '/thread/[id]'; params: { id: string } }

const SESSION_PATH = /^\/sessions\/([^/]+)\/?$/
const THREAD_PATH = /^\/thread\/([^/]+)\/?$/

const pathOf = (input: string): string | undefined => {
  let url: URL
  try {
    url = new URL(input, 'https://atlas.invalid')
  } catch {
    return undefined
  }
  const path =
    url.protocol === 'http:' || url.protocol === 'https:'
      ? url.pathname
      : `${url.host}${url.pathname}`
  return path.startsWith('/') ? path : `/${path}`
}

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export const destinationOfUrl = (input: string | null | undefined): TDestination | undefined => {
  if (input === null || input === undefined || input.length === 0) return undefined
  const path = pathOf(input)
  if (path === undefined) return undefined
  const session = SESSION_PATH.exec(path)
  if (session?.[1] !== undefined)
    return { pathname: '/sessions/[id]', params: { id: decodeSegment(session[1]) } }
  const thread = THREAD_PATH.exec(path)
  if (thread?.[1] !== undefined)
    return { pathname: '/thread/[id]', params: { id: decodeSegment(thread[1]) } }
  return undefined
}
