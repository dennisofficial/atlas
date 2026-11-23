import type { ChangeBlobRow } from '../change-content'
import { changeHashOf } from '../change-content'
import { ContextContentStore } from '../context-content'
import { FakeChangeContentStore } from './fake-change-content'

export class FakeContextContentStore extends ContextContentStore {
  private readonly inner: FakeChangeContentStore

  constructor(args: { clock?: (() => number) | undefined } = {}) {
    super()
    this.inner = new FakeChangeContentStore(args)
  }

  static hashOf(bytes: Uint8Array): string {
    return changeHashOf(bytes)
  }

  get puts(): readonly string[] {
    return this.inner.puts
  }

  put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    return this.inner.put(args)
  }

  read(args: { hash: string }): Promise<Uint8Array | null> {
    return this.inner.read(args)
  }

  presignGet(args: { hash: string; ttlMs: number }): Promise<string> {
    return this.inner.presignGet(args)
  }

  removing(hashes: readonly string[]): Promise<void> {
    return this.inner.removing(hashes)
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return this.inner.list()
  }
}
