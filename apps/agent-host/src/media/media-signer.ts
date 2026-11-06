import { mediaPathname, validUntilOf, windowStartOf } from '@dltech/atlas-core'
import type { MediaStore, ReadDelegation } from '@dltech/atlas-media'

import type { SecretCipher } from '../config/secret-cipher'
import type { MediaSigningWindows, SigningWindowRow } from './media-signing-windows'

type HeldWindow = { windowStart: number; validUntil: number; delegation: ReadDelegation }

export class MediaSigner {
  private readonly store: MediaStore
  private readonly windows: MediaSigningWindows
  private readonly cipher: Pick<SecretCipher, 'encrypt' | 'decrypt'>
  private readonly now: () => number
  private held: HeldWindow | null = null
  private inFlight: Promise<void> | null = null

  constructor(args: {
    store: MediaStore
    windows: MediaSigningWindows
    cipher: Pick<SecretCipher, 'encrypt' | 'decrypt'>
    now: () => number
  }) {
    this.store = args.store
    this.windows = args.windows
    this.cipher = args.cipher
    this.now = args.now
  }

  ready(): Promise<void> {
    const windowStart = windowStartOf(this.now())
    if (this.held?.windowStart === windowStart) return Promise.resolve()
    if (this.inFlight !== null) return this.inFlight
    const loading = this.adopt(windowStart).finally(() => {
      this.inFlight = null
    })
    this.inFlight = loading
    return loading
  }

  async urlOf(args: { userId: string; hash: string }): Promise<string> {
    const held = this.held
    if (held === null || held.windowStart !== windowStartOf(this.now())) {
      throw new Error('MediaSigner.urlOf called before ready() for the current signing window')
    }
    return this.store.presignGet({
      delegation: held.delegation,
      pathname: mediaPathname(args),
      validUntil: held.validUntil,
    })
  }

  private async adopt(windowStart: number): Promise<void> {
    const existing = await this.windows.find(windowStart)
    if (existing === null) await this.issue(windowStart)
    const row = existing ?? (await this.windows.find(windowStart))
    if (row === null) throw new Error(`signing window ${windowStart} missing after insert`)
    this.held = this.holdOf({ windowStart, row })
  }

  private async issue(windowStart: number): Promise<void> {
    const validUntil = validUntilOf(windowStart)
    const delegation = await this.store.issueReadDelegation({ validUntil })
    await this.windows.insertIfAbsent({
      windowStart,
      validUntil,
      sealed: this.cipher.encrypt(JSON.stringify(delegation)),
    })
  }

  private holdOf(args: { windowStart: number; row: SigningWindowRow }): HeldWindow {
    const delegation = JSON.parse(this.cipher.decrypt(args.row.sealed)) as ReadDelegation
    return { windowStart: args.windowStart, validUntil: args.row.validUntil, delegation }
  }
}
