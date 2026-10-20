import { isUnderPath } from '@dltech/atlas-core'

import { CONTAINER_GNUPG_HOME, type SandboxConfig, type SandboxEngine } from './sandbox'
import { runSandboxScript } from './sandbox-scripts'

const quoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export async function prepareContainerForOperator(args: {
  engine: SandboxEngine
  containerId: string
  config: SandboxConfig
}): Promise<void> {
  const { config } = args
  const entry = `atlas:x:${config.uid}:${config.gid}:atlas:${config.home}:/bin/sh`
  const commands = [
    `if ! grep -q '^[^:]*:[^:]*:${config.uid}:' /etc/passwd; then printf '%s\\n' ${quoted(entry)} >> /etc/passwd; fi`,
    'mkdir -p /etc/sudoers.d',
    `printf 'atlas ALL=(ALL) NOPASSWD: ALL\\n' > /etc/sudoers.d/atlas-operator && chmod 0440 /etc/sudoers.d/atlas-operator`,
    // sudo's account phase (pam_unix acct_mgmt) rejects a passwd-only user as locked ("account
    // validation failure"), because there is no shadow row; `atlas:!:` marks the account
    // unlocked-without-password so NOPASSWD sudo can evaluate.
    `if ! grep -q '^atlas:' /etc/shadow; then printf 'atlas:!:20000:0:99999:7:::\\n' >> /etc/shadow; fi`,
  ]
  const hostRoots = [config.worktree, ...(config.mounts ?? []).map((mount) => mount.path)]
  const homeIsMounted = hostRoots.some((directory) =>
    isUnderPath({ directory, path: config.home }),
  )
  if (!homeIsMounted && config.home !== '/') {
    commands.push(`mkdir -p ${quoted(config.home)}`)
    commands.push(`chown ${config.uid}:${config.gid} ${quoted(config.home)}`)
  }

  const sockets = [config.dockerSocket]
  if (config.sshAuthSock !== undefined) sockets.push(config.sshAuthSock)
  if (config.gpgAgentExtraSocket !== undefined) {
    commands.push(`chown ${config.uid}:${config.gid} ${CONTAINER_GNUPG_HOME}`)
    commands.push(`chmod 700 ${CONTAINER_GNUPG_HOME}`)
    sockets.push(`${CONTAINER_GNUPG_HOME}/S.gpg-agent`)
  }
  // Docker Desktop proxies macOS sockets as root:root 0660 regardless of host permissions.
  commands.push(`chmod 666 ${sockets.map(quoted).join(' ')}`)

  const outcome = await runSandboxScript({
    engine: args.engine,
    containerId: args.containerId,
    script: commands.join(' && '),
    cwd: '/',
    user: '0',
  })
  if (outcome.exitCode !== 0) {
    throw new Error(`operator setup failed in ${args.containerId}: ${outcome.output.slice(-2000)}`)
  }
}
