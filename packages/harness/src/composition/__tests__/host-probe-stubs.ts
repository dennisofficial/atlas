import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterAll, beforeAll } from 'bun:test'

const STUBBED_PROBES = ['gh', 'gpgconf']

export const stubHostProbes = (): void => {
  let directory: string | undefined
  let previousPath: string | undefined

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'atlas-host-probes-'))
    for (const name of STUBBED_PROBES) {
      const stub = join(directory, name)
      writeFileSync(stub, '#!/bin/sh\nexit 1\n')
      chmodSync(stub, 0o755)
    }
    previousPath = process.env.PATH
    process.env.PATH = [directory, previousPath].filter((one) => one !== undefined).join(delimiter)
  })

  afterAll(() => {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  })
}
