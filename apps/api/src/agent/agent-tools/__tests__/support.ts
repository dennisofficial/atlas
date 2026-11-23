import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll } from 'bun:test'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'

import { ShellLauncher, type ShellLaunchArgs, type ShellLaunchOutcome } from '../shell-launcher'
import { LocalFileSystemPort } from './support-filesystem'
import { LocalProcessPort } from './support-process'

export const files = new LocalFileSystemPort()
export const processes = new LocalProcessPort()

export const useTempAtlasHome = (): void => {
  const previous = process.env[ATLAS_HOME_ENV]
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'atlas-spec-home-'))
    process.env[ATLAS_HOME_ENV] = home
  })
  afterAll(() => {
    if (previous === undefined) delete process.env[ATLAS_HOME_ENV]
    else process.env[ATLAS_HOME_ENV] = previous
    rmSync(home, { recursive: true, force: true })
  })
}

export class TestShellLauncher extends ShellLauncher {
  readonly launched: ShellLaunchArgs[] = []

  constructor(private readonly answer: ShellLaunchOutcome = { ok: true, pid: 4_242 }) {
    super()
  }

  async launch(args: ShellLaunchArgs): Promise<ShellLaunchOutcome> {
    this.launched.push(args)
    return this.answer
  }
}

export const launcher = new TestShellLauncher()
