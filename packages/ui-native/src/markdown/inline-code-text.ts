const THIN_SPACE = '\u2009'

export const inlineCodeTextOf = (value: string): string => `${THIN_SPACE}${value}${THIN_SPACE}`
