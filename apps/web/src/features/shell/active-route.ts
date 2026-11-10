import { EAppNav } from './shell-types'

const THREAD_PATH = /^\/threads\/([^/]+)\/?$/
const SESSION_PATH = /^\/sessions\/([^/]+)\/?$/
const NEW_THREAD_SEGMENT = 'new'
const PROJECTS_PATH = /^\/projects(\/|$)/
const ROUTINES_PATH = /^\/routines(\/|$)/
const ROUTINE_PATH = /^\/routines\/([^/]+)\/?$/

export function activeThreadIdOf(pathname: string): string | null {
  const segment = THREAD_PATH.exec(pathname)?.[1]
  if (segment === undefined || segment === NEW_THREAD_SEGMENT) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function activeSessionIdOf(pathname: string): string | null {
  const segment = SESSION_PATH.exec(pathname)?.[1]
  if (segment === undefined) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function activeRoutineIdOf(pathname: string): string | null {
  const segment = ROUTINE_PATH.exec(pathname)?.[1]
  if (segment === undefined) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function activeNavOf(pathname: string): EAppNav {
  if (PROJECTS_PATH.test(pathname)) return EAppNav.Projects
  return ROUTINES_PATH.test(pathname) ? EAppNav.Routines : EAppNav.Threads
}
