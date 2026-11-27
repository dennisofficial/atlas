import { describe, expect, it } from 'bun:test'

import { MODEL_SEARCH_PLACEHOLDER, modelSearchBarPropsOf } from '../model-search-bar'

describe('modelSearchBarPropsOf', () => {
  it('puts the search field in the top bar row of the sheet, centred where iOS allows it', () => {
    expect(modelSearchBarPropsOf()).toMatchObject({
      placement: 'integratedCentered',
      allowToolbarIntegration: false,
      hideWhenScrolling: true,
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
