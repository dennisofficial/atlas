import {
  type ChangeBlobRow,
  ChangeContentStore,
  changeHashOf,
  type PresignGetArgs,
  type PresignPutArgs,
} from '../change-content'

const HASH_PATH = /^\/([0-9a-f]{64})$/

export class FakeChangeContentStore extends ChangeContentStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; createdAt: number }>()
  private readonly clock: () => number
  private uploads: ReturnType<typeof Bun.serve> | null = null
  readonly puts: string[] = []

  constructor(args: { clock?: (() => number) | undefined } = {}) {
    super()
    this.clock = args.clock ?? (() => Date.now())
  }

  static hashOf(bytes: Uint8Array): string {
    return changeHashOf(bytes)
  }

  put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    this.keep(args.hash, args.bytes)
    return Promise.resolve()
  }

  read(args: { hash: string }): Promise<Uint8Array | null> {
    const object = this.objects.get(args.hash)
    return Promise.resolve(object === undefined ? null : new Uint8Array(object.bytes))
  }

  presignGet(args: PresignGetArgs): Promise<string> {
    const query = [
      `ttl=${args.ttlMs}`,
      ...(args.contentType === undefined ? [] : [`contentType=${args.contentType}`]),
      ...(args.downloadName === undefined ? [] : [`downloadName=${args.downloadName}`]),
    ].join('&')
    return Promise.resolve(`fake://changes/${args.hash}?${query}`)
  }

  presignPut(args: PresignPutArgs): Promise<string> {
    return Promise.resolve(
      `http://127.0.0.1:${this.uploadServer().port}/${args.hash}?ttl=${args.ttlMs}`,
    )
  }

  exists(args: { hash: string }): Promise<boolean> {
    return Promise.resolve(this.objects.has(args.hash))
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

  private keep(hash: string, bytes: Uint8Array): void {
    if (!this.objects.has(hash)) {
      this.objects.set(hash, { bytes: new Uint8Array(bytes), createdAt: this.clock() })
    }
    this.puts.push(hash)
  }

  private uploadServer(): ReturnType<typeof Bun.serve> {
    if (this.uploads !== null) return this.uploads
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const match = HASH_PATH.exec(new URL(request.url).pathname)
        if (request.method !== 'PUT' || match === null || match[1] === undefined) {
          return new Response(null, { status: 404 })
        }
        this.keep(match[1], new Uint8Array(await request.arrayBuffer()))
        return new Response(null, { status: 200 })
      },
    })
    server.unref()
    this.uploads = server
    return server
  }
}
