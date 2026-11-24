import { join } from 'node:path'
import { createSecretsStore } from './secrets-store'

const TOKEN_NAME = 'desktop-cloud-token'
const EMAIL_NAME = 'desktop-cloud-email'
const DEVICE_ID_NAME = 'desktop-device-id'

export interface ITokenStore {
  token: () => string | undefined
  email: () => string | undefined
  deviceId: () => string | undefined
  save: (args: { token: string; email?: string | undefined }) => void
  saveDeviceId: (value: string) => void
  clear: () => void
}

export function createTokenStore({ home }: { home: string }): ITokenStore {
  const secrets = createSecretsStore({
    file: join(home, 'secrets.json'),
    keyFile: join(home, 'key'),
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
    deviceId: () => safeRead(DEVICE_ID_NAME),
    save: ({ token, email }) => {
      secrets.write({ name: TOKEN_NAME, value: token })
      if (email === undefined) secrets.remove(EMAIL_NAME)
      else secrets.write({ name: EMAIL_NAME, value: email })
    },
    saveDeviceId: (value) => secrets.write({ name: DEVICE_ID_NAME, value }),
    clear: () => {
      secrets.remove(TOKEN_NAME)
      secrets.remove(EMAIL_NAME)
    },
  }
}
