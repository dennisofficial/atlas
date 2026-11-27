import type { SearchBarProps } from 'react-native-screens'

export const MODEL_SEARCH_PLACEHOLDER = 'Search models'

export const modelSearchBarPropsOf = (): Pick<
  SearchBarProps,
  | 'allowToolbarIntegration'
  | 'autoCapitalize'
  | 'hideNavigationBar'
  | 'hideWhenScrolling'
  | 'obscureBackground'
  | 'placeholder'
  | 'placement'
> => ({
  allowToolbarIntegration: false,
  autoCapitalize: 'none',
  hideNavigationBar: false,
  hideWhenScrolling: false,
  obscureBackground: false,
  placeholder: MODEL_SEARCH_PLACEHOLDER,
  placement: 'stacked',
})
