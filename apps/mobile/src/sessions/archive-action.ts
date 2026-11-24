import { ENavigationAction, type TNavigationAction } from '../navigation/root-navigation'
import { isSessionsPath } from '../navigation/tabs'

export type TArchiveOutcome = {
  deselect: boolean
  navigation: TNavigationAction
}

const STAY: TNavigationAction = { action: ENavigationAction.None }

export const archiveOutcomeOf = ({
  archivedId,
  selectedId,
  pathname,
}: {
  archivedId: string
  selectedId: string | null
  pathname: string
}): TArchiveOutcome => {
  if (archivedId !== selectedId) return { deselect: false, navigation: STAY }
  if (!isSessionsPath(pathname)) return { deselect: true, navigation: STAY }
  return {
    deselect: true,
    navigation: { action: ENavigationAction.Replace, href: '/sessions' },
  }
}
