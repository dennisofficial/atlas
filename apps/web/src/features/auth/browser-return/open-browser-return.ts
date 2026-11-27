import { EReturnSurface, startLinkFor, stateOfStartLink } from '@dltech/atlas-core'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'

import { returnWindowNameOf } from './return-action'

export const RETURN_WINDOW_FEATURES = 'noopener,noreferrer'

export const openReturnTargetOf = (args: {
  url: string
  desktop: boolean
}): {
  href: string
  windowName: string
  features: string
} => ({
  href: startLinkFor({
    url: args.url,
    surface: args.desktop ? EReturnSurface.Desktop : EReturnSurface.Web,
  }),
  windowName: returnWindowNameOf(stateOfStartLink(args.url)),
  features: RETURN_WINDOW_FEATURES,
})

export const openBrowserReturn = (args: { url: string; host?: object }): void => {
  const target = openReturnTargetOf({
    url: args.url,
    desktop: isDesktopHost(args.host ?? window),
  })
  window.open(target.href, target.windowName, target.features)
}
