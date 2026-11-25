import type { HeaderBarButtonItem, SearchBarProps } from 'react-native-screens'

import { ESessionsListLayout } from '../layout/posture'

export const drawerSearchBarPropsOf = ({
  listLayout,
}: {
  listLayout: ESessionsListLayout
}): Pick<
  SearchBarProps,
  'allowToolbarIntegration' | 'autoCapitalize' | 'placeholder' | 'placement'
> => ({
  allowToolbarIntegration: false,
  autoCapitalize: 'none',
  placeholder: 'Search',
  placement: listLayout === ESessionsListLayout.Panel ? 'stacked' : 'integratedButton',
})

const accountBarItemOf = ({ onPress }: { onPress: () => void }): HeaderBarButtonItem => ({
  accessibilityLabel: 'Settings',
  icon: { type: 'sfSymbol', name: 'person.crop.circle' },
  onPress,
  type: 'button',
})

const newSessionBarItemOf = ({ onPress }: { onPress: () => void }): HeaderBarButtonItem => ({
  accessibilityLabel: 'New session',
  icon: { type: 'sfSymbol', name: 'plus' },
  onPress,
  type: 'button',
})

export const drawerBarItemsOf = ({
  showsAccount,
  onAccount,
  onNewSession,
}: {
  showsAccount: boolean
  onAccount: () => void
  onNewSession: () => void
}): { left: HeaderBarButtonItem[]; right: HeaderBarButtonItem[] } => ({
  left: showsAccount ? [accountBarItemOf({ onPress: onAccount })] : [],
  right: [newSessionBarItemOf({ onPress: onNewSession })],
})
