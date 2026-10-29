import { useSyncExternalStore } from 'react'

const RETURN_PATH_KEY = 'atlas:return-path'
export const DEFAULT_RETURN_PATH = '/threads'

function isInAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}

export function rememberReturnPath(path: string): void {
  if (!isInAppPath(path)) return
  sessionStorage.setItem(RETURN_PATH_KEY, path)
}

export function readReturnPath(): string {
  const stored = sessionStorage.getItem(RETURN_PATH_KEY)
  return stored !== null && isInAppPath(stored) ? stored : DEFAULT_RETURN_PATH
}

const subscribeToNothing = () => () => {}
const serverReturnPath = () => DEFAULT_RETURN_PATH

export function useReturnPath(): string {
  return useSyncExternalStore(subscribeToNothing, readReturnPath, serverReturnPath)
}
