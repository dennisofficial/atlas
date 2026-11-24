import { router } from 'expo-router'

import { ENavigationAction, type TNavigationAction } from './root-navigation'

export const applyNavigation = (navigation: TNavigationAction): void => {
  if (navigation.action === ENavigationAction.None) return
  if (navigation.action === ENavigationAction.Push) {
    router.push(navigation.href)
    return
  }
  router.dismissAll()
  router.replace(navigation.href)
}
