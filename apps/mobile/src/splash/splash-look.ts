export const SPLASH_LIGHT_BACKGROUND = '#fbf7f2'
export const SPLASH_DARK_BACKGROUND = '#1e1a17'

export const splashBackgroundOf = ({ dark }: { dark: boolean }): string =>
  dark ? SPLASH_DARK_BACKGROUND : SPLASH_LIGHT_BACKGROUND
