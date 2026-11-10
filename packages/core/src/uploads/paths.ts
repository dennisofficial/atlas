import { UPLOADS_DIR } from './limits'

/** Where a file an attachment needs lands in the sandbox: keyed by its own id, never by name. */
export function uploadPathOf(args: { fileId: string; name: string }): string {
  return `${UPLOADS_DIR}/${args.fileId}/${args.name}`
}
