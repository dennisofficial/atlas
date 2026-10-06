import { join } from 'node:path'

import { gpgKeyMaterialSchema, type GpgKeyMaterial } from '@dltech/atlas-harness'

import { EProfileStep, EProfileStepState, type ProfileStepOutcome } from './environment-profile'
import type { GitRunner } from './materialize-workspace'
import { verifyGitConfigs, writeGitConfigs } from './profile-git-config'
import type { CommandRunner } from './run-command'
import type { WorkspaceFiles } from './workspace-files'
import type { WorkspaceSpec } from './workspace-spec'

export type GpgStepResult = { outcome: ProfileStepOutcome; probed: boolean }

export type ApplyGpgSigning = (args: {
  cwd: string
  spec: WorkspaceSpec
}) => Promise<GpgStepResult>

const outcome = (
  state: EProfileStepState,
  detail?: string | undefined,
): GpgStepResult => ({
  outcome: { step: EProfileStep.GpgSigning, state, detail },
  probed: false,
})

const parseMaterial = (
  raw: string,
): { material: GpgKeyMaterial } | { result: GpgStepResult } => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { result: outcome(EProfileStepState.Failed, 'the gpg material did not parse') }
  }
  const parsed = gpgKeyMaterialSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const named =
      issue === undefined ? 'unknown issue' : `${issue.path.join('.')}: ${issue.message}`
    return {
      result: outcome(EProfileStepState.Failed, `the gpg material is invalid: ${named}`),
    }
  }
  return { material: parsed.data }
}

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

const objectIdOf = (stdout: string): string | null => {
  const id = stdout.trim()
  return OBJECT_ID.test(id) ? id : null
}

const probeSigning = async (args: {
  run: CommandRunner
  git: GitRunner
  cwd: string
}): Promise<string | null> => {
  const { run, git, cwd } = args
  const tree = await run({ command: ['git', 'mktree'], cwd, stdin: '' })
  const treeId = tree.ok ? objectIdOf(tree.stdout) : null
  if (treeId === null) {
    return tree.stderr.trim() || 'git mktree did not return a tree id for the signing probe'
  }
  const signed = await git({
    args: ['commit-tree', treeId, '-S', '-m', 'atlas signing probe'],
    cwd,
  })
  const commitId = signed.ok ? objectIdOf(signed.stdout) : null
  if (commitId === null) {
    return signed.stderr.trim() || 'git could not sign the probe commit'
  }
  const verified = await git({ args: ['verify-commit', commitId], cwd })
  if (!verified.ok) return verified.stderr.trim() || 'git could not verify the probe signature'
  return null
}

export function createGpgSigningStep(args: {
  files: WorkspaceFiles
  run: CommandRunner
  git: GitRunner
}): ApplyGpgSigning {
  const { files, run, git } = args

  return async ({ cwd, spec }) => {
    if (spec.gpgKey === null || spec.gpgKey === undefined) {
      return outcome(EProfileStepState.Skipped)
    }
    const parsed = parseMaterial(spec.gpgKey)
    if ('result' in parsed) return parsed.result
    const material = parsed.material

    if (!(await files.exists(join(cwd, '.git')))) {
      return outcome(EProfileStepState.Skipped, 'the workspace is not a git repository')
    }

    const imported = await run({
      command: ['gpg', '--batch', '--import'],
      cwd,
      stdin: `${material.secretKey}\n${material.publicKey}`,
    })
    if (!imported.ok) {
      return outcome(EProfileStepState.Failed, imported.stderr.trim())
    }
    if (material.ownerTrust !== '') {
      const trusted = await run({
        command: ['gpg', '--batch', '--import-ownertrust'],
        cwd,
        stdin: material.ownerTrust,
      })
      if (!trusted.ok) {
        return outcome(EProfileStepState.Failed, trusted.stderr.trim())
      }
    }

    const configs = [
      ['user.signingkey', material.keyId],
      ['commit.gpgsign', String(material.sign)],
      ['gpg.format', 'openpgp'],
      ['gpg.program', 'gpg'],
    ] as const
    const configFailure =
      (await writeGitConfigs({ git, cwd, entries: configs })) ??
      (await verifyGitConfigs({ git, cwd, entries: configs }))
    if (configFailure !== null) return outcome(EProfileStepState.Failed, configFailure)

    const probeFailure = await probeSigning({ run, git, cwd })
    if (probeFailure !== null) return outcome(EProfileStepState.Failed, probeFailure)
    return {
      outcome: { step: EProfileStep.GpgSigning, state: EProfileStepState.Applied },
      probed: true,
    }
  }
}
