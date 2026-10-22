import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { fileSignInOffer } from '../sign-in-offer'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-sign-in-offer-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('fileSignInOffer', () => {
  it('has not offered when no marker exists', () => {
    expect(fileSignInOffer({ directory }).offered()).toBe(false)
  })

  it('remembers the offer across instances, like a second boot', () => {
    fileSignInOffer({ directory }).markOffered()

    expect(fileSignInOffer({ directory }).offered()).toBe(true)
  })

  it('creates the home directory when marking before it exists', () => {
    const nested = join(directory, 'fresh-home')

    fileSignInOffer({ directory: nested }).markOffered()

    expect(fileSignInOffer({ directory: nested }).offered()).toBe(true)
  })

  it('treats an empty marker as not offered', () => {
    writeFileSync(join(directory, 'cloud-sign-in-offered'), '')

    expect(fileSignInOffer({ directory }).offered()).toBe(false)
  })
})
