import * as WebBrowser from 'expo-web-browser'

export const APP_RETURN_URL = 'atlas://'

export const openSignIn = async (url: string): Promise<void> => {
  await WebBrowser.openAuthSessionAsync(url, APP_RETURN_URL)
}
