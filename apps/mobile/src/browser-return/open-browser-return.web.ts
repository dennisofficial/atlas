import { EReturnSurface, type ReturnOutcome, startLinkFor } from '@dltech/atlas-core'
import * as WebBrowser from 'expo-web-browser'

export const openBrowserReturn = async (args: {
  url: string
}): Promise<ReturnOutcome | undefined> => {
  await WebBrowser.openBrowserAsync(startLinkFor({ url: args.url, surface: EReturnSurface.Web }))
  return undefined
}
