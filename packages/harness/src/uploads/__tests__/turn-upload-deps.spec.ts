import { describe, expect, it } from 'bun:test'

import { createIsolatedContainer } from '../../container/injection'
import { ServeSessionToken, SessionRegistryToken } from '../../container/tokens'
import type { SessionRegistry } from '../../store/sessions/registry'
import { MissingSaidUploads } from '../missing-said-uploads'
import { registerSaidUploads } from '../register-said-uploads'
import { turnUploadDeps } from '../turn-upload-deps'

const composed = ({ signedIn }: { signedIn: boolean }) => {
  const container = createIsolatedContainer()
  container.register(SessionRegistryToken, { useValue: {} as SessionRegistry })
  if (signedIn) {
    container.register(ServeSessionToken, {
      useValue: { url: 'https://api.test', token: 'sandbox-token', email: null },
    })
  }
  registerSaidUploads({ container })
  return turnUploadDeps(container)
}

describe('turnUploadDeps', () => {
  it('hands a serve turn an attachment url resolver beside its uploads', () => {
    const deps = composed({ signedIn: true })

    expect(deps.mediaUrls).toBeDefined()
    expect(deps.uploads).not.toBeInstanceOf(MissingSaidUploads)
  })

  it('binds no resolver where no cloud session can sign a download', () => {
    const deps = composed({ signedIn: false })

    expect(deps.mediaUrls).toBeUndefined()
    expect(deps.uploads).toBeInstanceOf(MissingSaidUploads)
  })
})
