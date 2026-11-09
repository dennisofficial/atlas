import { describe, expect, it } from 'bun:test'

import { SecretCipher } from '../../config/secret-cipher'
import { webSearchConfigOf, type WebSearchRows } from '../web-search-config'

const KEY = 'a'.repeat(64)

const cipher = new SecretCipher(KEY)

const setting = (value: string): string => `atlas-setting:v1:${JSON.stringify(value)}`

const sealedValueOf = (value: string): string => cipher.encrypt(JSON.stringify(value))

const rowsOf = (args: {
  userSetting?: string | null
  projectSetting?: string | null
  userSecret?: string | null
  projectSecret?: string | null
}): WebSearchRows => ({
  userSetting: async () => (args.userSetting === undefined ? null : { value: args.userSetting }),
  projectSetting: async () =>
    args.projectSetting === undefined ? null : { value: args.projectSetting },
  userSecret: async () => (args.userSecret === undefined ? null : { sealedValue: args.userSecret }),
  projectSecret: async () =>
    args.projectSecret === undefined ? null : { sealedValue: args.projectSecret },
})

const configOf = (rows: WebSearchRows): ReturnType<typeof webSearchConfigOf> =>
  webSearchConfigOf({ rows, cipher, userId: 'usr-1', projectId: 'prj-1' })

describe('webSearchConfigOf', () => {
  it('answers no backend when the operator never chose one', async () => {
    expect(await configOf(rowsOf({}))).toEqual({ backend: undefined, key: undefined })
  })

  it('reads the backend and its own secret name', async () => {
    const rows = rowsOf({
      userSetting: setting('brave'),
      userSecret: sealedValueOf('sk-brave'),
    })

    expect(await configOf(rows)).toEqual({ backend: 'brave', key: 'sk-brave' })
  })

  it('prefers the project row over the user row for both the setting and the key', async () => {
    const rows = rowsOf({
      userSetting: setting('brave'),
      projectSetting: setting('tavily'),
      userSecret: sealedValueOf('sk-user'),
      projectSecret: sealedValueOf('sk-project'),
    })

    expect(await configOf(rows)).toEqual({ backend: 'tavily', key: 'sk-project' })
  })

  it('answers no key for a keyless backend', async () => {
    const rows = rowsOf({ userSetting: setting('bing') })

    expect(await configOf(rows)).toEqual({ backend: 'bing', key: undefined })
  })

  it('answers no key rather than failing on a secret it cannot open', async () => {
    const rows = rowsOf({
      userSetting: setting('brave'),
      userSecret: 'not-a-sealed-blob',
    })

    expect(await configOf(rows)).toEqual({ backend: 'brave', key: undefined })
  })
})
