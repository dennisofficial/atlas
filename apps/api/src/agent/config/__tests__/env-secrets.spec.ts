import { describe, expect, it } from 'bun:test'

import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { readEnvSecrets, type EnvSecretRows, type SealedSecretRow } from '../env-secrets'

const KEY = 'a'.repeat(64)

const cipher = new SecretCipher(KEY)

const row = (name: string, value: string): SealedSecretRow => ({
  name,
  sealedValue: cipher.encrypt(JSON.stringify(value)),
})

const rowsOf = (args: {
  user?: readonly SealedSecretRow[]
  group?: readonly SealedSecretRow[]
  project?: readonly SealedSecretRow[]
}): EnvSecretRows => ({
  userSecrets: async () => args.user ?? [],
  groupSecrets: async () => args.group ?? [],
  projectSecrets: async () => args.project ?? [],
})

const read = (rows: EnvSecretRows): ReturnType<typeof readEnvSecrets> =>
  readEnvSecrets({ rows, cipher, userId: 'usr-1', projectId: 'prj-1' })

describe('readEnvSecrets', () => {
  it('unseals the user and project secrets into an env record', async () => {
    const exported = await read(
      rowsOf({
        user: [row('PERSONAL_TOKEN', 'personal')],
        project: [row('CLAUDE_SECURITY_TOKEN', 'project')],
      }),
    )

    expect(exported.env).toEqual({
      PERSONAL_TOKEN: 'personal',
      CLAUDE_SECURITY_TOKEN: 'project',
    })
  })

  it('takes the group value over the personal one and the project value over the group one', async () => {
    const overGroup = await read(
      rowsOf({ user: [row('API_KEY', 'personal')], group: [row('API_KEY', 'group')] }),
    )
    expect(overGroup.env).toEqual({ API_KEY: 'group' })

    const overBoth = await read(
      rowsOf({
        user: [row('API_KEY', 'personal')],
        group: [row('API_KEY', 'group')],
        project: [row('API_KEY', 'project')],
      }),
    )
    expect(overBoth.env).toEqual({ API_KEY: 'project' })
  })

  it('takes the project value over the personal one of the same name', async () => {
    const exported = await read(
      rowsOf({ user: [row('API_KEY', 'personal')], project: [row('API_KEY', 'project')] }),
    )

    expect(exported.env).toEqual({ API_KEY: 'project' })
  })

  it('reads only the user secrets when the session has no project', async () => {
    const asked: unknown[] = []
    const rows: EnvSecretRows = {
      userSecrets: async () => [row('PERSONAL_TOKEN', 'personal')],
      groupSecrets: async (lookup) => {
        asked.push(lookup)
        return []
      },
      projectSecrets: async (lookup) => {
        asked.push(lookup)
        return []
      },
    }

    const exported = await readEnvSecrets({ rows, cipher, userId: 'usr-1', projectId: null })

    expect(exported.env).toEqual({ PERSONAL_TOKEN: 'personal' })
    expect(asked).toEqual([])
  })

  it('skips a row that does not open and keeps the rest', async () => {
    const exported = await read(
      rowsOf({
        user: [{ name: 'BROKEN', sealedValue: cipher.encrypt('not json') }, row('KEPT', 'yes')],
        project: [{ name: 'GARBLED', sealedValue: 'nonsense' }],
      }),
    )

    expect(exported.env).toEqual({ KEPT: 'yes' })
  })
})
