import { type BrowserReturn, browserReturnOf, withoutReturnParams } from '@dltech/atlas-core'

export const RETURN_CHANNEL_NAME = 'atlas-return'
export const RETURN_WINDOW_PREFIX = 'atlas-return-'

export type ReturnAction = {
  returned: BrowserReturn
  cleanHref: string
  close: boolean
}

export const returnWindowNameOf = (state: string | undefined): string =>
  `${RETURN_WINDOW_PREFIX}${state ?? ''}`

export const returnActionOf = (args: {
  href: string
  windowName: string
}): ReturnAction | undefined => {
  const returned = browserReturnOf(args.href)
  if (returned === undefined) return undefined
  return {
    returned,
    cleanHref: withoutReturnParams(args.href),
    close: args.windowName.startsWith(RETURN_WINDOW_PREFIX),
  }
}
