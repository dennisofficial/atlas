import { describe, expect, it } from 'bun:test'

import { MODEL_SEARCH_PLACEHOLDER, modelSearchBarPropsOf } from '../model-search-bar'

describe('modelSearchBarPropsOf', () => {
  it('puts a full-width search field at the top of the sheet and keeps it there while the list scrolls', () => {
    expect(modelSearchBarPropsOf()).toMatchObject({
      placement: 'stacked',
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
