import { EColorScheme, type SemanticTheme, semantic } from '@dltech/atlas-ui/tokens'

export const schemeOf = (system: string | null | undefined): EColorScheme =>
  system === EColorScheme.Dark ? EColorScheme.Dark : EColorScheme.Light

export const resolveTheme = (system: string | null | undefined): SemanticTheme =>
  semantic[schemeOf(system)]
