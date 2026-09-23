import { z } from 'zod'

import { gitOneLine } from './git-text'
import { runGit, type GitRun } from './run-git'
import type { GitReader } from './snapshot'

export const gpgKeyMaterialSchema = z.object({
  keyId: z.string().min(1),
  publicKey: z.string().min(1),
  secretKey: z.string().min(1),
  ownerTrust: z.string(),
  sign: z.boolean(),
})

export type GpgKeyMaterial = z.infer<typeof gpgKeyMaterialSchema>

export type GpgRunner = (args: { args: readonly string[] }) => Promise<GitRun>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const runGpg: GpgRunner = async ({ args }) => {
  try {
    const gpg = Bun.spawn(['gpg', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })
    const [stdout, stderr, status] = await Promise.all([
      new Response(gpg.stdout).text(),
      new Response(gpg.stderr).text(),
      gpg.exited,
    ])
    return { ok: status === 0, stdout, stderr }
  } catch (error) {
    return { ok: false, stdout: '', stderr: messageOf(error) }
  }
}

const textOf = (run: GitRun): string | null => {
  if (!run.ok || run.stdout.trim() === '') return null
  return run.stdout
}

/**
 * The operator's signing material, exported for a sandbox to import: the secret half travels
 * only because porting the user's keys into containers is the decided direction. The loopback
 * pinentry with an empty passphrase is what lets an unprotected key export non-interactively; a
 * passphrase-protected key refuses, and the lift carries no gpg material rather than prompting.
 * https://gnupg.org/documentation/manuals/gnupg/Agent-Options.html#index-pinentry_002dmode
 */
export async function exportGpgMaterial(args: {
  cwd: string
  read?: GitReader | undefined
  gpg?: GpgRunner | undefined
}): Promise<GpgKeyMaterial | null> {
  const read = args.read ?? runGit
  const gpg = args.gpg ?? runGpg

  const keyId = gitOneLine(await read({ args: ['config', 'user.signingkey'], cwd: args.cwd }))
  if (keyId === null) return null

  const sign = gitOneLine(await read({ args: ['config', 'commit.gpgsign'], cwd: args.cwd }))

  const [exported, exportedSecret, ownerTrust] = await Promise.all([
    gpg({ args: ['--batch', '--armor', '--export', keyId] }),
    gpg({
      args: [
        '--batch',
        '--yes',
        '--pinentry-mode',
        'loopback',
        '--passphrase',
        '',
        '--armor',
        '--export-secret-keys',
        keyId,
      ],
    }),
    gpg({ args: ['--batch', '--export-ownertrust'] }),
  ])

  const publicKey = textOf(exported)
  const secretKey = textOf(exportedSecret)
  if (publicKey === null || secretKey === null) return null

  return {
    keyId,
    publicKey,
    secretKey,
    ownerTrust: ownerTrust.ok ? ownerTrust.stdout : '',
    sign: sign === 'true',
  }
}
