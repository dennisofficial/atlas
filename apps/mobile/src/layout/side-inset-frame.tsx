import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { sideColumnInsetOf, type TInsets } from './posture'

const WindowInsetsContext = createContext<TInsets | null>(null)

const OWN_INSET_ROUTES: ReadonlySet<string> = new Set(['(tabs)', 'new', 'model', 'photo'])

type TScreenLayoutProps = { route: { name: string }; children: ReactElement }

export const WindowInsetsProvider = ({ children }: { children: ReactNode }) => (
  <WindowInsetsContext.Provider value={useSafeAreaInsets()}>
    {children}
  </WindowInsetsContext.Provider>
)

export const SideInsetFrame = ({ children }: { children: ReactNode }) => {
  const windowInsets = useContext(WindowInsetsContext)
  const measured = useSafeAreaInsets()
  const insets = windowInsets ?? measured
  const side = sideColumnInsetOf(insets)
  const contentInsets = useMemo(() => ({ ...insets, right: insets.right - side }), [insets, side])
  return (
    <SafeAreaInsetsContext.Provider value={contentInsets}>
      <View style={[styles.root, { paddingRight: side }]}>{children}</View>
    </SafeAreaInsetsContext.Provider>
  )
}

export const SideInsetLayout = ({ route, children }: TScreenLayoutProps) =>
  OWN_INSET_ROUTES.has(route.name) ? children : <SideInsetFrame>{children}</SideInsetFrame>

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
