import type { HeaderBarButtonItem, SearchBarProps } from 'react-native-screens'

import { ESessionsListLayout } from '../layout/posture'

export const usesNativeSearchOf = ({ listLayout }: { listLayout: ESessionsListLayout }): boolean =>
  listLayout !== ESessionsListLayout.Panel

export const drawerSearchBarPropsOf = (): Pick<
  SearchBarProps,
  'allowToolbarIntegration' | 'autoCapitalize' | 'placeholder' | 'placement'
> => ({
  allowToolbarIntegration: false,
  autoCapitalize: 'none',
  placeholder: 'Search',
  placement: 'integratedButton',
})

const newSessionBarItemOf = ({ onPress }: { onPress: () => void }): HeaderBarButtonItem => ({
  accessibilityLabel: 'New session',
  icon: { type: 'sfSymbol', name: 'plus' },
  onPress,
  type: 'button',
})

export const drawerBarItemsOf = ({
  onNewSession,
}: {
  onNewSession: () => void
}): { right: HeaderBarButtonItem[] } => ({
  right: [newSessionBarItemOf({ onPress: onNewSession })],
})
