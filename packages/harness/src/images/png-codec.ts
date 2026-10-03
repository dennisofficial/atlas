import { deflateSync, inflateSync } from 'node:zlib'

import type { PngCodec } from '@dltech/atlas-core'

/** Core is pure and imports no node builtins, so the zlib the PNG codec needs is supplied here. */
export const zlibPngCodec: PngCodec = {
  inflate: (bytes) => new Uint8Array(inflateSync(bytes)),
  deflate: (bytes) => new Uint8Array(deflateSync(bytes)),
}
