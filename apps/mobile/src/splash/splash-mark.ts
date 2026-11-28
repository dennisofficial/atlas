const light = require('../../assets/images/splash-mark-light.png')
const dark = require('../../assets/images/splash-mark-dark.png')

export const SPLASH_MARK_ASPECT = 1024 / 830

export const splashMarkOf = ({ dark: isDark }: { dark: boolean }): number => (isDark ? dark : light)
