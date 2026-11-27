import { EMcpSignInSurface, signInUrlFor } from '@dltech/atlas-plugin-mcp/core'
import * as WebBrowser from 'expo-web-browser'

export const APP_RETURN_URL = 'atlas://'

export const openSignIn = async (url: string): Promise<void> => {
  await WebBrowser.openAuthSessionAsync(
    signInUrlFor({ url, surface: EMcpSignInSurface.Ios }),
    APP_RETURN_URL,
  )
}
