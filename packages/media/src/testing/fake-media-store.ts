import { MediaStore, type ReadDelegation } from '../media-store'

export class FakeMediaStore extends MediaStore {
  issued = 0
  readonly blobs = new Map<string, number>()
  readonly contents = new Map<string, Uint8Array>()
  readonly deleted: string[] = []

  put(args: { pathname: string; bytes: Uint8Array }): void {
    this.blobs.set(args.pathname, args.bytes.byteLength)
    this.contents.set(args.pathname, args.bytes)
  }

  async issueReadDelegation(args: { validUntil: number }): Promise<ReadDelegation> {
    this.issued += 1
    return {
      delegationToken: `delegation-${this.issued}`,
      clientSigningToken: `signing-${this.issued}`,
      validUntil: args.validUntil,
    }
  }

  async presignGet(args: {
    delegation: ReadDelegation
    pathname: string
    validUntil: number
  }): Promise<string> {
    return `https://blob.fake/${args.pathname}?delegation=${args.delegation.delegationToken}&validUntil=${args.validUntil}`
  }

  async presignPut(args: {
    pathname: string
    maximumSizeInBytes: number
    validUntil: number
  }): Promise<string> {
    return `https://blob.fake/put/${args.pathname}?max=${args.maximumSizeInBytes}&validUntil=${args.validUntil}`
  }

  async head(args: { pathname: string }): Promise<{ size: number } | null> {
    const size = this.blobs.get(args.pathname)
    return size === undefined ? null : { size }
  }

  async read(args: { pathname: string }): Promise<Uint8Array | null> {
    return this.contents.get(args.pathname) ?? null
  }

  async delete(args: { pathnames: string[] }): Promise<void> {
    for (const pathname of args.pathnames) {
      this.blobs.delete(pathname)
      this.contents.delete(pathname)
      this.deleted.push(pathname)
    }
  }
}
