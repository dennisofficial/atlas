import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const HARNESS_ROOT = join(import.meta.dir, '..', '..')
const SUPERVISOR_ENTRY = join(import.meta.dir, 'durable', 'supervisor-main.ts')

export const supervisorBundleFile = (): string =>
  join(HARNESS_ROOT, 'bin', 'atlas-supervisor.js')

export async function bundleSupervisorSource(args?: { entry?: string | undefined }): Promise<string> {
  const result = await Bun.build({
    entrypoints: [args?.entry ?? SUPERVISOR_ENTRY],
    target: 'bun',
  })
  const output = result.outputs[0]
  if (!result.success || output === undefined) {
    throw new Error(`the shell supervisor failed to bundle: ${result.logs.map(String).join('\n')}`)
  }
  return await output.text()
}

export async function writeSupervisorBundle(args?: { outfile?: string | undefined; entry?: string | undefined }): Promise<string> {
  const outfile = args?.outfile ?? supervisorBundleFile()
  const text = await bundleSupervisorSource({ entry: args?.entry })
  await mkdir(dirname(outfile), { recursive: true })
  const staging = `${outfile}.${process.pid}.tmp`
  await writeFile(staging, text)
  await rename(staging, outfile)
  return outfile
}
