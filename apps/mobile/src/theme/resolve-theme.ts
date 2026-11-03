import { EColorScheme, semantic } from '@dltech/atlas-ui/tokens'
import type { SemanticTheme } from '@dltech/atlas-ui/tokens'

export const resolveTheme = ({ scheme }: { scheme: string | null | undefined }): SemanticTheme =>
  scheme === EColorScheme.Dark ? semantic[EColorScheme.Dark] : semantic[EColorScheme.Light]
