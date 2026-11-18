import { type ChangeBlobRow, ChangeContentStore, changeHashOf } from '../change-content'

export class FakeChangeContentStore extends ChangeContentStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; createdAt: number }>()
  private readonly clock: () => number
  readonly puts: string[] = []

  constructor(args: { clock?: (() => number) | undefined } = {}) {
    super()
    this.clock = args.clock ?? (() => Date.now())
  }

  static hashOf(bytes: Uint8Array): string {
    return changeHashOf(bytes)
  }

  put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    if (!this.objects.has(args.hash)) {
      this.objects.set(args.hash, { bytes: new Uint8Array(args.bytes), createdAt: this.clock() })
    }
    this.puts.push(args.hash)
    return Promise.resolve()
  }

  read(args: { hash: string }): Promise<Uint8Array | null> {
    const object = this.objects.get(args.hash)
    return Promise.resolve(object === undefined ? null : new Uint8Array(object.bytes))
  }

  presignGet(args: { hash: string; ttlMs: number }): Promise<string> {
    return Promise.resolve(`fake://changes/${args.hash}?ttl=${args.ttlMs}`)
  }

  removing(hashes: readonly string[]): Promise<void> {
    for (const hash of hashes) this.objects.delete(hash)
    return Promise.resolve()
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return Promise.resolve(
      [...this.objects.entries()].map(([hash, object]) => ({
        hash,
        size: object.bytes.byteLength,
        createdAt: object.createdAt,
      })),
    )
  }
}
