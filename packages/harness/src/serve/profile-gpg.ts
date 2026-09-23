import { join } from 'node:path'

import { gpgKeyMaterialSchema, type GpgKeyMaterial } from '../workspace/gpg-material'

import { EProfileStep, EProfileStepState, type ProfileStepOutcome } from './environment-profile'
import type { GitRunner } from './materialize-workspace'
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

    const configs = await Promise.all([
      git({ args: ['config', 'user.signingkey', material.keyId], cwd }),
      git({ args: ['config', 'commit.gpgsign', String(material.sign)], cwd }),
    ])
    const failedConfig = configs.find((one) => !one.ok)
    if (failedConfig !== undefined) {
      return outcome(EProfileStepState.Failed, failedConfig.stderr.trim())
    }

    const probe = await run({
      command: ['gpg', '--batch', '--list-secret-keys', material.keyId],
      cwd,
    })
    if (!probe.ok) {
      return outcome(EProfileStepState.Failed, probe.stderr.trim())
    }
    return { outcome: { step: EProfileStep.GpgSigning, state: EProfileStepState.Applied }, probed: true }
  }
}
