import { join } from 'node:path'
import { FileSecretsStore, SecretCipher } from '@dltech/atlas-harness'

const TOKEN_NAME = 'desktop-cloud-token'
const EMAIL_NAME = 'desktop-cloud-email'

export interface ITokenStore {
  token: () => string | undefined
  email: () => string | undefined
  save: (args: { token: string; email?: string | undefined }) => void
  clear: () => void
}

export function createTokenStore({ home }: { home: string }): ITokenStore {
  const secrets = new FileSecretsStore({
    file: join(home, 'secrets.json'),
    cipher: new SecretCipher(join(home, 'key')),
  })
  const safeRead = (name: string): string | undefined => {
    try {
      return secrets.read(name)
    } catch {
      return undefined
    }
  }
  return {
    token: () => safeRead(TOKEN_NAME),
    email: () => safeRead(EMAIL_NAME),
    save: ({ token, email }) => {
      secrets.write({ name: TOKEN_NAME, value: token })
      if (email === undefined) secrets.remove(EMAIL_NAME)
      else secrets.write({ name: EMAIL_NAME, value: email })
    },
    clear: () => {
      secrets.remove(TOKEN_NAME)
      secrets.remove(EMAIL_NAME)
    },
  }
}
