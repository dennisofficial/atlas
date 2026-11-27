import { EMcpSignInSurface, signInUrlFor } from '@dltech/atlas-plugin-mcp/core'
import * as WebBrowser from 'expo-web-browser'

export const openSignIn = async (url: string): Promise<void> => {
  await WebBrowser.openBrowserAsync(signInUrlFor({ url, surface: EMcpSignInSurface.Web }))
}
