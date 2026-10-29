import { describe, expect, test } from 'bun:test'

import { ESecretsScope, type LibrarySecret } from '../../../settings/fixtures/settings-library'
import {
  overriddenKeys,
  parseEnvText,
  partitionByScope,
  updateEntry,
  upsertEntries,
} from '../secrets-model'

function row({ key, scope }: { key: string; scope: ESecretsScope }): LibrarySecret {
  return { id: `${scope}-${key}`, key, value: 'old', updated: '1d ago', scope }
}

describe('parseEnvText', () => {
  test('skips comments, blanks and lines without an equals sign', () => {
    const text = '# note\n\nA=1\nnot a pair\nB=two=parts'
    expect(parseEnvText({ text })).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: 'two=parts' },
    ])
  })

  test('strips export prefixes and matching quotes', () => {
    const text = 'export TOKEN="abc def"\nNAME=\'x\''
    expect(parseEnvText({ text })).toEqual([
      { key: 'TOKEN', value: 'abc def' },
      { key: 'NAME', value: 'x' },
    ])
  })

  test('drops lines with an empty key', () => {
    expect(parseEnvText({ text: '=value' })).toEqual([])
  })
})

describe('overriddenKeys', () => {
  test('lists personal keys shadowed by a project row', () => {
    const rows = [
      row({ key: 'A', scope: ESecretsScope.Project }),
      row({ key: 'A', scope: ESecretsScope.Personal }),
      row({ key: 'B', scope: ESecretsScope.Personal }),
    ]
    expect([...overriddenKeys(rows)]).toEqual(['A'])
  })

  test('is empty when only personal rows exist', () => {
    expect(overriddenKeys([row({ key: 'A', scope: ESecretsScope.Personal })]).size).toBe(0)
  })
})

describe('upsertEntries', () => {
  test('replaces same-scope rows and leaves inherited rows alone', () => {
    const rows = [
      row({ key: 'A', scope: ESecretsScope.Project }),
      row({ key: 'A', scope: ESecretsScope.Personal }),
    ]
    const next = upsertEntries({
      rows,
      entries: [{ key: 'A', value: 'new' }],
      scope: ESecretsScope.Project,
    })
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ key: 'A', value: 'new', scope: ESecretsScope.Project })
    expect(next[1]).toMatchObject({ key: 'A', scope: ESecretsScope.Personal, value: 'old' })
  })
})

describe('updateEntry', () => {
  test('keeps the current value when the new one is blank', () => {
    const rows = [row({ key: 'A', scope: ESecretsScope.Personal })]
    const next = updateEntry({
      rows,
      entry: { key: 'A', value: '' },
      scope: ESecretsScope.Personal,
    })
    expect(next[0]).toMatchObject({ value: 'old', updated: 'just now' })
  })
})

describe('partitionByScope', () => {
  const rows = [
    row({ key: 'A', scope: ESecretsScope.Personal }),
    row({ key: 'A', scope: ESecretsScope.Project }),
    row({ key: 'B', scope: ESecretsScope.Personal }),
  ]

  test('on the project page, project rows are own and personal rows follow as inherited', () => {
    const { own, inherited } = partitionByScope({ rows, scope: ESecretsScope.Project })
    expect(own.map((r) => r.id)).toEqual(['project-A'])
    expect(inherited.map((r) => r.id)).toEqual(['personal-A', 'personal-B'])
  })

  test('on the personal page everything is own', () => {
    const { own, inherited } = partitionByScope({
      rows: rows.filter((r) => r.scope === ESecretsScope.Personal),
      scope: ESecretsScope.Personal,
    })
    expect(own).toHaveLength(2)
    expect(inherited).toHaveLength(0)
  })
})

describe('editing a personal value from the project page', () => {
  const rows = [
    row({ key: 'A', scope: ESecretsScope.Project }),
    row({ key: 'A', scope: ESecretsScope.Personal }),
  ]

  test('updates the personal row and leaves the project row alone', () => {
    const next = updateEntry({
      rows,
      entry: { key: 'A', value: 'mine' },
      scope: ESecretsScope.Personal,
    })
    expect(next[0]).toMatchObject({ scope: ESecretsScope.Project, value: 'old' })
    expect(next[1]).toMatchObject({ scope: ESecretsScope.Personal, value: 'mine' })
  })
})
