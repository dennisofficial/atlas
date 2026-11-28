import { describe, expect, it } from 'bun:test'
import { EAccessScope } from '@dltech/atlas-wire/web'

import { parseEnvLines, SECRET_NAME } from '../secrets'
import { accessParamsOfScope, accessScopeOfParams } from '../routes'

describe('secret input', () => {
  it('parses env values, preserving equals and quotes and reporting line numbers', () => {
    expect(
      parseEnvLines(
        '# comment\n\n API_KEY=one=two \nBAD-NAME=x\n2KEY=x\nEMPTY=\nKEY="quoted"\nmissing',
      ),
    ).toEqual({
      pairs: [
        { name: 'API_KEY', value: 'one=two' },
        { name: 'EMPTY', value: '' },
        { name: 'KEY', value: '"quoted"' },
      ],
      invalid: [4, 5, 8],
    })
  })
  it('accepts uppercase variable names, not lowercase or leading digits', () => {
    for (const name of ['A', '_TOKEN', 'API_KEY2']) expect(SECRET_NAME.test(name)).toBe(true)
    for (const name of ['', 'a', '2A', 'A-B', 'A B']) expect(SECRET_NAME.test(name)).toBe(false)
  })
})

describe('access scope route parameters', () => {
  it('round trips all scopes, including punctuation in ids', () => {
    for (const scope of [
      { kind: EAccessScope.Personal },
      { kind: EAccessScope.Group, groupId: 'group:/one' },
      { kind: EAccessScope.Project, projectId: 'project two' },
    ] as const) {
      expect(accessScopeOfParams(accessParamsOfScope(scope))).toEqual(scope)
    }
  })
  it('defaults unknown or incomplete parameters to personal', () => {
    expect(accessScopeOfParams({})).toEqual({ kind: EAccessScope.Personal })
    expect(accessScopeOfParams({ scope: 'project' })).toEqual({ kind: EAccessScope.Personal })
    expect(accessScopeOfParams({ scope: 'other', scopeId: 'x' })).toEqual({
      kind: EAccessScope.Personal,
    })
  })
})
