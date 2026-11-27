import { describe, expect, it } from 'bun:test'

import { MODEL_SEARCH_PLACEHOLDER, modelSearchBarPropsOf } from '../model-search-bar'

describe('modelSearchBarPropsOf', () => {
  it('puts the search field in the sheet bar and keeps it there while the list scrolls', () => {
    expect(modelSearchBarPropsOf()).toMatchObject({
      placement: 'integrated',
      allowToolbarIntegration: false,
      hideWhenScrolling: false,
      hideNavigationBar: false,
      obscureBackground: false,
    })
  })

  it('searches model names as typed', () => {
    expect(modelSearchBarPropsOf()).toMatchObject({
      autoCapitalize: 'none',
      placeholder: MODEL_SEARCH_PLACEHOLDER,
    })
  })
})
