import type { SemanticTheme } from '@dltech/atlas-ui/tokens'
import { useColorScheme } from 'react-native'

import { resolveTheme } from './resolve-theme'

export { resolveTheme }

export const useTheme = (): SemanticTheme => resolveTheme({ scheme: useColorScheme() })
