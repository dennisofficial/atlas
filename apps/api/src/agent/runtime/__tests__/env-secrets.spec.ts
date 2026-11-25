import { describe, expect, it } from 'bun:test'

import { RESERVED_ENV_PREFIX, exportEnvSecretsOf, type CloudSecret } from '../env-secrets'
import { ShellEnvCell } from '../shell-env'

const secret = (name: string, value: string): CloudSecret => ({ name, value })

describe('exportEnvSecretsOf', () => {
  it('exports the user and project secrets by name', () => {
    const exported = exportEnvSecretsOf({
      user: [secret('PERSONAL_TOKEN', 'personal')],
      group: [],
      project: [secret('CLAUDE_SECURITY_TOKEN', 'project')],
    })

    expect(exported.env).toEqual({
      PERSONAL_TOKEN: 'personal',
      CLAUDE_SECURITY_TOKEN: 'project',
    })
    expect(exported.names).toEqual(['CLAUDE_SECURITY_TOKEN', 'PERSONAL_TOKEN'])
  })

  it('lets a project secret override the user secret of the same name', () => {
    const exported = exportEnvSecretsOf({
      user: [secret('API_KEY', 'personal')],
      group: [],
      project: [secret('API_KEY', 'project')],
    })

    expect(exported.env).toEqual({ API_KEY: 'project' })
  })

  it('skips names an env var cannot hold and Atlas-owned names', () => {
    const exported = exportEnvSecretsOf({
      user: [secret('search.brave', 'x'), secret('2LEADING_DIGIT', 'x')],
      group: [],
      project: [secret(`${RESERVED_ENV_PREFIX}HOME`, '/atlas'), secret('GOOD_NAME_1', 'y')],
    })

    expect(exported.env).toEqual({ GOOD_NAME_1: 'y' })
  })

  it('exports nothing when neither scope has a usable secret', () => {
    expect(exportEnvSecretsOf({ user: [], group: [], project: [] })).toEqual({ env: {}, names: [] })
  })
})

describe('ShellEnvCell secrets', () => {
  it('keeps Atlas-owned git variables above the exported secrets', async () => {
    const cell = new ShellEnvCell({ identityOf: async () => ({ name: 'n', email: 'e' }) })
    cell.setSecrets(
      exportEnvSecretsOf({
        user: [secret('GH_TOKEN', 'from-a-secret'), secret('API_KEY', 'k')],
        group: [],
        project: [],
      }),
    )
    await cell.refresh({
      token: 'gho_abc',
      signing: null,
      launchDirectory: '/w',
      signal: new AbortController().signal,
    })

    expect(cell.current().GH_TOKEN).toBe('gho_abc')
    expect(cell.current().API_KEY).toBe('k')
  })

  it('drops a secret the moment the cloud config stops listing it', () => {
    const cell = new ShellEnvCell({ identityOf: async () => ({ name: 'n', email: 'e' }) })
    cell.setSecrets(exportEnvSecretsOf({ user: [secret('OLD_KEY', 'x')], group: [], project: [] }))
    cell.setSecrets(exportEnvSecretsOf({ user: [], group: [], project: [] }))

    expect(cell.current()).toEqual({})
  })
})
