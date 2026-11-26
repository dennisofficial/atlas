import { ETextRole, typeScale } from './scale'

export const READING_LEADING =
  typeScale[ETextRole.Reading].lineHeight / typeScale[ETextRole.Reading].fontSize

export const READING_HEADING_LEADING = 1.375

export const READING_MEASURE_REM = 56

export const readingRole = {
  body: ETextRole.Reading,
  h1: ETextRole.Xl,
  h2: ETextRole.Lg,
  h3: ETextRole.Reading,
  h4: ETextRole.Reading,
  h5: ETextRole.Reading,
  h6: ETextRole.Sm,
} as const

const typeOf = (role: ETextRole, leading: number) => ({
  fontSize: typeScale[role].fontSize,
  lineHeight: Math.round(typeScale[role].fontSize * leading),
})

export const readingType = {
  body: typeOf(readingRole.body, READING_LEADING),
  h1: typeOf(readingRole.h1, READING_HEADING_LEADING),
  h2: typeOf(readingRole.h2, READING_HEADING_LEADING),
  h3: typeOf(readingRole.h3, READING_HEADING_LEADING),
  h4: typeOf(readingRole.h4, READING_HEADING_LEADING),
  h5: typeOf(readingRole.h5, READING_HEADING_LEADING),
  h6: typeOf(readingRole.h6, READING_HEADING_LEADING),
} as const

export const readingClasses = {
  body: 'text-base leading-relaxed',
  h1: 'text-xl leading-snug',
  h2: 'text-lg leading-snug',
  h3: 'text-base leading-snug',
  h4: 'text-base leading-snug',
  h5: 'text-base leading-snug',
  h6: 'text-sm leading-snug',
  composer: 'md:text-base',
  measure: 'max-w-4xl',
} as const
