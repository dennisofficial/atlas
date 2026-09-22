import { execFile } from 'node:child_process'

export class GitCredentialError extends Error {
  constructor(detail: string) {
    super(`cloud sandboxes push and pull over https with your github token — ${detail}`)
    this.name = 'GitCredentialError'
  }
}

export type ExecOutcome = { stdout: string; stderr: string }

export type ExecFileFn = (args: { cmd: string; args: readonly string[] }) => Promise<ExecOutcome>

const errnoCodeOf = (failure: unknown): string | undefined => {
  if (!(failure instanceof Error)) return undefined
  if (!('code' in failure)) return undefined
  return typeof failure.code === 'string' ? failure.code : undefined
}

const liveExec: ExecFileFn = ({ cmd, args }) =>
  new Promise((resolve, reject) => {
    execFile(cmd, [...args], (error, stdout, stderr) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })

/**
 * Read fresh at every claim: a `gh` OAuth token (gho_*) does not expire on a timer, but the CLI's
 * own refresh and the operator switching accounts both land here without Atlas noticing. The token
 * rides the claim body to the control plane row and from there into the sandbox's https remote —
 * never an SSH key.
 */
export async function readGhAuthToken(args?: {
  exec?: ExecFileFn | undefined
}): Promise<string> {
  const exec = args?.exec ?? liveExec

  let outcome: ExecOutcome
  try {
    outcome = await exec({ cmd: 'gh', args: ['auth', 'token'] })
  } catch (failure) {
    if (errnoCodeOf(failure) === 'ENOENT') {
      throw new GitCredentialError('install the GitHub CLI and run `gh auth login`, then try again')
    }
    throw new GitCredentialError('run `gh auth login`, then try again')
  }

  const token = outcome.stdout.trim()
  if (token.length === 0) {
    throw new GitCredentialError('run `gh auth login`, then try again')
  }
  return token
}
