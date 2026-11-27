import {
  EReturnSurface,
  IOS_RETURN_URL,
  type ReturnOutcome,
  startLinkFor,
} from '@dltech/atlas-core'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import * as WebBrowser from 'expo-web-browser'

import { acceptedReturnOf } from './return-outcome'

export const openBrowserReturn = async (args: {
  url: string
}): Promise<ReturnOutcome | undefined> => {
  const startLink = startLinkFor({ url: args.url, surface: EReturnSurface.Ios })
  const result = await WebBrowser.openAuthSessionAsync(startLink, IOS_RETURN_URL)
  if (result.type !== 'success') return undefined
  const accepted = acceptedReturnOf({ startLink, returnedUrl: result.url })
  if (accepted === undefined) return undefined
  browserReturns.remember(accepted)
  return accepted.outcome
}
