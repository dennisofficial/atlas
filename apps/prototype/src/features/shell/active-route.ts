import { EAppNav } from './shell-types'

const THREAD_PATH = /^\/threads\/([^/]+)\/?$/
const NEW_THREAD_SEGMENT = 'new'
const PROJECTS_PATH = /^\/projects(\/|$)/
const ROUTINES_PATH = /^\/routines(\/|$)/

export function activeThreadIdOf(pathname: string): string | null {
  const segment = THREAD_PATH.exec(pathname)?.[1]
  if (segment === undefined || segment === NEW_THREAD_SEGMENT) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function activeRoutineIdOf(pathname: string): string | undefined {
  const match = /^\/routines\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1])
}

export function activeNavOf(pathname: string): EAppNav {
  if (PROJECTS_PATH.test(pathname)) return EAppNav.Projects
  if (ROUTINES_PATH.test(pathname)) return EAppNav.Routines
  return EAppNav.Threads
}
