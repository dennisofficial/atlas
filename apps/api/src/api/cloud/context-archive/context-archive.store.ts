export const CONTEXT_ARCHIVE_STORE = Symbol('CONTEXT_ARCHIVE_STORE')

/**
 * The bytes of a tar.gz context archive, keyed by the sandbox row that owns it. The first
 * implementation keeps them on the existing `CloudSandbox` row; an object storage adapter can
 * replace it later without touching any caller.
 */
export interface ContextArchiveStore {
  readSandboxArchive(args: { threadId: string }): Promise<Buffer | null>
  writeSandboxArchive(args: { threadId: string; archive: Buffer }): Promise<void>
  readSandboxTranscript(args: { threadId: string }): Promise<Buffer | null>
  writeSandboxTranscript(args: { threadId: string; archive: Buffer }): Promise<void>
}
