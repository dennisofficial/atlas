import * as WebBrowser from 'expo-web-browser'

export const openSignIn = async (url: string): Promise<void> => {
  await WebBrowser.openBrowserAsync(url)
}
