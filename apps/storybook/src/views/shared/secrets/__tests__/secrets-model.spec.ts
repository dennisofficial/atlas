import { describe, expect, test } from 'bun:test'

import {
  ESecretKind,
  ESecretsScope,
  type LibrarySecret,
} from '../../../../fixtures/settings-library'
import {
  overriddenKeys,
  parseEnvText,
  partitionByScope,
  splitByKind,
  updateEntry,
  upsertEntries,
} from '../secrets-model'

function row({
  key,
  scope,
  kind = ESecretKind.Secret,
}: {
  key: string
  scope: ESecretsScope
  kind?: ESecretKind
}): LibrarySecret {
  return { id: `${scope}-${key}`, key, kind, value: 'old', updated: '1d ago', scope }
}

describe('parseEnvText', () => {
  test('skips comments, blanks and lines without an equals sign', () => {
    const text = '# note\n\nA=1\nnot a pair\nB=two=parts'
    expect(parseEnvText({ text, kind: ESecretKind.EnvVar })).toEqual([
      { key: 'A', value: '1', kind: ESecretKind.EnvVar },
      { key: 'B', value: 'two=parts', kind: ESecretKind.EnvVar },
    ])
  })

  test('strips export prefixes and matching quotes', () => {
    const text = 'export TOKEN="abc def"\nNAME=\'x\''
    expect(parseEnvText({ text, kind: ESecretKind.Secret })).toEqual([
      { key: 'TOKEN', value: 'abc def', kind: ESecretKind.Secret },
      { key: 'NAME', value: 'x', kind: ESecretKind.Secret },
    ])
  })

  test('applies the requested kind to every line', () => {
    const entries = parseEnvText({ text: 'A=1\nB=2', kind: ESecretKind.Secret })
    expect(entries.every((entry) => entry.kind === ESecretKind.Secret)).toBe(true)
  })

  test('drops lines with an empty key', () => {
    expect(parseEnvText({ text: '=value', kind: ESecretKind.EnvVar })).toEqual([])
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
      entries: [{ key: 'A', value: 'new', kind: ESecretKind.EnvVar }],
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
      entry: { key: 'A', value: '', kind: ESecretKind.EnvVar },
      scope: ESecretsScope.Personal,
    })
    expect(next[0]).toMatchObject({ value: 'old', kind: ESecretKind.EnvVar, updated: 'just now' })
  })
})

describe('splitByKind', () => {
  test('groups env vars and secrets', () => {
    const rows = [
      row({ key: 'A', scope: ESecretsScope.Personal, kind: ESecretKind.EnvVar }),
      row({ key: 'B', scope: ESecretsScope.Personal }),
    ]
    const { envVars, secrets } = splitByKind(rows)
    expect(envVars.map((r) => r.key)).toEqual(['A'])
    expect(secrets.map((r) => r.key)).toEqual(['B'])
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
      entry: { key: 'A', value: 'mine', kind: ESecretKind.Secret },
      scope: ESecretsScope.Personal,
    })
    expect(next[0]).toMatchObject({ scope: ESecretsScope.Project, value: 'old' })
    expect(next[1]).toMatchObject({ scope: ESecretsScope.Personal, value: 'mine' })
  })
})
