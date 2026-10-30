import { describe, expect, it } from 'bun:test'

import { PR_EDIT_MUTED_AUTHORS_FALLBACK } from '@dltech/atlas-core'
import { decodeSettingValue, encodeSettingValue } from '@dltech/atlas-wire/web'

import {
  MUTED_EDITORS_KEY,
  URGENT_EDITORS_KEY,
  prCommentEditorChanges,
  prCommentEditorsOf,
} from '../pr-comment-editors'

describe('prCommentEditorsOf', () => {
  it('shows the defaults when nothing is stored', () => {
    expect(prCommentEditorsOf(new Map())).toEqual({
      muted: PR_EDIT_MUTED_AUTHORS_FALLBACK,
      urgent: '',
    })
  })

  it('reads stored values decoded from the codec', () => {
    const values = new Map([
      [MUTED_EDITORS_KEY, decodeSettingValue(encodeSettingValue('renovate'))],
      [URGENT_EDITORS_KEY, decodeSettingValue(encodeSettingValue('coderabbit'))],
    ])
    expect(prCommentEditorsOf(values)).toEqual({
      muted: 'renovate',
      urgent: 'coderabbit',
    })
  })

  it('ignores non-text stored values', () => {
    expect(prCommentEditorsOf(new Map([[MUTED_EDITORS_KEY, 3]])).muted).toBe(
      PR_EDIT_MUTED_AUTHORS_FALLBACK,
    )
  })
})

describe('prCommentEditorChanges', () => {
  it('removes keys whose text equals the default', () => {
    expect(
      prCommentEditorChanges({
        draft: { muted: ` ${PR_EDIT_MUTED_AUTHORS_FALLBACK} `, urgent: '  ' },
      }),
    ).toEqual({
      [MUTED_EDITORS_KEY]: null,
      [URGENT_EDITORS_KEY]: null,
    })
  })

  it('writes trimmed custom text, and an emptied mute list', () => {
    expect(prCommentEditorChanges({ draft: { muted: '', urgent: ' coderabbit ' } })).toEqual({
      [MUTED_EDITORS_KEY]: '',
      [URGENT_EDITORS_KEY]: 'coderabbit',
    })
  })
})
