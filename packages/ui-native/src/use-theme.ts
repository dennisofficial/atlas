import { EColorScheme, type SemanticTheme, semantic } from '@dltech/atlas-ui/tokens'
import { useColorScheme } from 'react-native'

import { schemeOf } from './theme'

export const useScheme = (): EColorScheme => schemeOf(useColorScheme())

export const useTheme = (): SemanticTheme => semantic[useScheme()]

export const useIsDark = (): boolean => useScheme() === EColorScheme.Dark
