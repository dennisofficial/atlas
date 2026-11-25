export type TDrawerSearch = { focused: boolean; query: string }

export const emptyDrawerSearchOf = (): TDrawerSearch => ({ focused: false, query: '' })

export const searchFocusedOf = (search: TDrawerSearch): TDrawerSearch => ({
  ...search,
  focused: true,
})

export const searchTypedOf = ({
  search,
  text,
}: {
  search: TDrawerSearch
  text: string
}): TDrawerSearch => ({ ...search, query: text })

export const searchClearedOf = (search: TDrawerSearch): TDrawerSearch => ({ ...search, query: '' })

export const searchDismissedOf = (
  search: TDrawerSearch,
): { dismisses: boolean; search: TDrawerSearch } =>
  search.focused ? { dismisses: true, search: emptyDrawerSearchOf() } : { dismisses: false, search }
