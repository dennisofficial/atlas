export const SPLASH_LIGHT_BACKGROUND = '#f9f9f9'
export const SPLASH_DARK_BACKGROUND = '#1b1b1b'

export const SPLASH_MARK_LIGHT = './assets/images/splash-mark-light.png'
export const SPLASH_MARK_DARK = './assets/images/splash-mark-dark.png'

export const splashBackgroundOf = ({ dark }: { dark: boolean }): string =>
  dark ? SPLASH_DARK_BACKGROUND : SPLASH_LIGHT_BACKGROUND
