import { describe, expect, it } from 'bun:test'

import {
  emptyDrawerSearchOf,
  searchClearedOf,
  searchDismissedOf,
  searchFocusedOf,
  searchTypedOf,
} from '../drawer-search'

const typedSearchOf = () =>
  searchTypedOf({ search: searchFocusedOf(emptyDrawerSearchOf()), text: 'say' })

describe('searchDismissedOf', () => {
  it('clears the filter once the search bar is dismissed', () => {
    const dismissed = searchDismissedOf(typedSearchOf())
    expect(dismissed.dismisses).toBe(true)
    expect(dismissed.search).toEqual({ focused: false, query: '' })
  })

  it('keeps the filter when a blur never followed a focus', () => {
    const typed = { focused: false, query: 'say' }
    expect(searchDismissedOf(typed)).toEqual({ dismisses: false, search: typed })
  })
})

describe('searchTypedOf', () => {
  it('changes the filter text while the search stays open', () => {
    expect(searchTypedOf({ search: searchFocusedOf(emptyDrawerSearchOf()), text: 'say' })).toEqual({
      focused: true,
      query: 'say',
    })
  })
})

describe('searchClearedOf', () => {
  it('drops the filter but leaves the search open for the cancel button', () => {
    expect(searchClearedOf(typedSearchOf())).toEqual({ focused: true, query: '' })
  })
})
