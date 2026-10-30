import { UPLOADS_DIR } from './limits'

export function uploadPathOf(args: { uploadId: string; name: string }): string {
  return `${UPLOADS_DIR}/${args.uploadId}/${args.name}`
}
