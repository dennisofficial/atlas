import { describe, expect, it } from 'bun:test'

import { LEXICAL_LANGUAGES, type LanguageSpec } from '@dltech/atlas-syntax/lexical'

import { codeScopes, codeTheme, rolesFor } from '../themes/index'
import { styleForGroup } from '../lexical-rows'

function groupsOf(spec: LanguageSpec): readonly string[] {
  return [
    ...(spec.rules ?? []).map((rule) => rule.group),
    ...Object.keys(spec.words ?? {}),
    ...(spec.call === undefined ? [] : [spec.call]),
    'number',
    'operator',
  ]
}

/**
 * A group that resolves to nothing is not an error anywhere in the stack — it renders as plain text,
 * silently, and only a human looking at a fence would ever notice. This is the only thing that
 * catches a typo like `function.method` written as `method`.
 */
describe('every group a lexical language emits', () => {
  const theme = codeTheme()
  const scopes = codeScopes({ theme })
  const plain = rolesFor({ theme }).plain

  it('resolves to a style of its own rather than falling through to plain', () => {
    const unresolved: string[] = []

    for (const spec of LEXICAL_LANGUAGES) {
      for (const group of groupsOf(spec)) {
        if (styleForGroup({ group, scopes, plain }) === plain) {
          unresolved.push(`${spec.filetype}: @${group}`)
        }
      }
    }

    expect([...new Set(unresolved)].sort()).toEqual([])
  })

  it('resolves a dotted group through its first segment only, as OpenTUI does', () => {
    expect(styleForGroup({ group: 'function.call', scopes, plain })).toBe(
      styleForGroup({ group: 'function', scopes, plain }),
    )
    expect(styleForGroup({ group: 'function', scopes, plain })).not.toBe(plain)
    expect(styleForGroup({ group: 'nonesuch.deeply.nested', scopes, plain })).toBe(plain)
  })
})
