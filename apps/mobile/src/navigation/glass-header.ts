import { isLiquidGlassAvailable } from 'expo-glass-effect'
import type { NativeStackNavigationOptions } from 'expo-router'
import { Platform } from 'react-native'

export const usesGlassHeader = (): boolean => Platform.OS === 'ios' && isLiquidGlassAvailable()

export const barHeaderOptionsOf = ({
  glass,
  background,
  foreground,
}: {
  glass: boolean
  background: string
  foreground: string
}): NativeStackNavigationOptions =>
  glass
    ? { headerTransparent: true, headerShadowVisible: false, headerTintColor: foreground }
    : {
        headerTransparent: false,
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
      }
