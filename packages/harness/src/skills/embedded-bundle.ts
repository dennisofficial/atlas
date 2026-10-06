import { createHash } from 'node:crypto'

export type EmbeddedSkillFile = {
  path: string
  digest: string
  read: () => Promise<Uint8Array>
}

export type EmbeddedSkillBundle = {
  digest: string
  files: readonly EmbeddedSkillFile[]
}

export type EmbeddedSkillEntry = {
  path: string
  text: string
  bundle?: EmbeddedSkillBundle | undefined
}

export class UnsafeBundlePath extends Error {
  constructor(path: string) {
    super(`bundled skill path ${JSON.stringify(path)} is not a plain relative path inside the skill directory`)
  }
}

export const digestOfBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export const digestOfText = (text: string): string => digestOfBytes(Buffer.from(text))

const WINDOWS_DRIVE = /^[a-zA-Z]:/

export const isSafeRelativePath = (path: string): boolean => {
  if (path === '' || path.startsWith('/') || WINDOWS_DRIVE.test(path)) return false
  if (path.includes('\\') || path.includes('\0')) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export const assertSafeRelativePath = (path: string): void => {
  if (!isSafeRelativePath(path)) throw new UnsafeBundlePath(path)
}

export class UnsafeBundleDigest extends Error {
  constructor(digest: string | undefined) {
    super(`bundle digest ${JSON.stringify(digest)} is not 64 lowercase hex characters`)
  }
}

export class UnsafeSkillName extends Error {
  constructor(name: string) {
    super(`skill name ${JSON.stringify(name)} is not a single safe path segment`)
  }
}

const BUNDLE_DIGEST = /^[a-f0-9]{64}$/

export const assertBundleDigest = (digest: string | undefined): string => {
  if (digest === undefined || !BUNDLE_DIGEST.test(digest)) throw new UnsafeBundleDigest(digest)
  return digest
}

export const assertSafeSegment = (name: string): void => {
  if (name.includes('/') || !isSafeRelativePath(name)) throw new UnsafeSkillName(name)
}

export const bundleDigestOf = (args: {
  entry: { path: string; digest: string }
  files: readonly { path: string; digest: string }[]
}): string => {
  const lines = [args.entry, ...args.files]
    .map((file) => `${file.path}\0${file.digest}\n`)
    .sort()
  return createHash('sha256').update(lines.join('')).digest('hex')
}

export const embeddedFile = (args: {
  path: string
  digest: string
  load: () => Promise<{ default: string }>
}): EmbeddedSkillFile => ({
  path: args.path,
  digest: args.digest,
  read: async () => new Uint8Array(await Bun.file((await args.load()).default).arrayBuffer()),
})
