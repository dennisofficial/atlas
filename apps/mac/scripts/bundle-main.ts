import { writeSupervisorBundle } from '../../../packages/harness/src/shells/supervisor-bundle'

await writeSupervisorBundle()

const result = await Bun.build({
  entrypoints: ['src/main/index.ts'],
  target: 'bun',
  outdir: 'main-out',
  external: ['electrobun', 'electrobun/*'],
})
if (!result.success) {
  for (const log of result.logs) console.error(String(log))
  process.exit(1)
}
