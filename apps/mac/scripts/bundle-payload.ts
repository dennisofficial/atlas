import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dir, '..')
export const PAYLOAD_ENTRY = join(APP_ROOT, 'payload-entry.ts')
export const PAYLOAD_OUTDIR = join(APP_ROOT, 'payload')
export const PAYLOAD_OUT = join(PAYLOAD_OUTDIR, 'web-payload.js')

export function payloadBuild({ entry = PAYLOAD_ENTRY, outdir = PAYLOAD_OUTDIR } = {}) {
  return Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    outdir,
    naming: 'web-payload.js',
  })
}

if (import.meta.main) {
  const result = await payloadBuild()
  if (!result.success) {
    for (const log of result.logs) console.error(String(log))
    process.exit(1)
  }
  console.log(`web payload updater at ${PAYLOAD_OUT}`)
}
