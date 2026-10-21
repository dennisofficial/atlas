import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterAll, beforeAll } from 'vitest'

const STUBBED_PROBES = ['gh', 'gpgconf']

export const stubHostProbes = (): void => {
  let directory: string | undefined
  let replaced: { previousPath: string | undefined } | undefined

  beforeAll(() => {
    const stubs = mkdtempSync(join(tmpdir(), 'atlas-host-probes-'))
    directory = stubs
    for (const name of STUBBED_PROBES) {
      const stub = join(stubs, name)
      writeFileSync(stub, '#!/bin/sh\nexit 1\n')
      chmodSync(stub, 0o755)
    }
    const previousPath = process.env.PATH
    replaced = { previousPath }
    process.env.PATH = [stubs, previousPath].filter((one) => one !== undefined).join(delimiter)
  })

  afterAll(() => {
    if (replaced !== undefined) {
      if (replaced.previousPath === undefined) delete process.env.PATH
      else process.env.PATH = replaced.previousPath
    }
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  })
}
