import { activeThreadIdOf } from './active-route'

export enum EShellBar {
  Global = 'global',
  Thread = 'thread',
}

export function shellBarOf(pathname: string): EShellBar {
  return activeThreadIdOf(pathname) === null ? EShellBar.Global : EShellBar.Thread
}
