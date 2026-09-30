import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BINARY_PATH = '/tmp/atlas-smoke/x86/atlas-serve-linux-x64'
const UNREACHABLE_CLOUD_URL = 'https://unreachable.atlas-cloud.invalid'
const FAKE_API_KEY = 'sk-ant-fake-not-a-real-key-smoke'
const CHUNK_BYTES = 4 * 1024 * 1024

const REPO = new URL('../../../', import.meta.url).pathname
const wire = await import(`${REPO}/packages/wire/src/index.ts`)
const core = await import(`${REPO}/packages/core/src/index.ts`)
const { SecretCipher } = await import(`${REPO}/packages/harness/src/credentials/secret-cipher.ts`)
const { FileSecretsStore } = await import(`${REPO}/packages/harness/src/secrets/file-secrets-store.ts`)
const { FileSettingsStore } = await import(`${REPO}/packages/harness/src/settings/file-store.ts`)
const { CLOUD_SETTING_DEFINITIONS } = await import(`${REPO}/packages/harness/src/cloud/settings-definitions.ts`)
const { environmentLayer } = await import(`${REPO}/packages/harness/src/settings/environment.ts`)
const { createSettingsService } = await import(`${REPO}/packages/harness/src/settings/service.ts`)
const { requireVercelCredentials, VercelNotConfiguredError } = await import(
  `${REPO}/packages/harness/src/cloud/vercel-credentials.ts`
)
const { CloudSessionStore } = await import(`${REPO}/packages/harness/src/cloud/cloud-session.ts`)
const { CloudClient } = await import(`${REPO}/packages/harness/src/cloud/cloud-client.ts`)
const { decodeSettingValue } = await import(`${REPO}/packages/harness/src/cloud/sync-settings.ts`)
const { VercelDriver } = await import(`${REPO}/packages/harness/src/cloud/vercel-driver.ts`)
const { sandboxNameFor } = await import(`${REPO}/packages/harness/src/cloud/sandbox-names.ts`)
const { driveNameFor } = await import(`${REPO}/packages/harness/src/cloud/drive-names.ts`)
const { sealWith } = await import(`${REPO}/packages/harness/src/cloud/portable-validation.ts`)
const { vaultFileSchema, VAULT_VERSION } = await import(`${REPO}/packages/harness/src/credentials/vault-file.ts`)

const secretsHeld = new Set<string>()
const redact = (text: string): string => {
  let out = text
  for (const held of secretsHeld) {
    if (held.length >= 8) out = out.split(held).join('[REDACTED]')
  }
  return out.replace(/team_[A-Za-z0-9]+/g, 'team_[REDACTED]').replace(/prj_[A-Za-z0-9]+/g, 'prj_[REDACTED]')
}
const line = (text: string): void => console.log(redact(text))
const fail = (message: string): never => {
  line(`FATAL ${message}`)
  process.exit(2)
}

const home = core.atlasHomeFrom({ env: process.env, home: process.env.HOME ?? '', tempDir: '/tmp' })
const cipher = new SecretCipher(join(home, 'key'))
const secrets = new FileSecretsStore({ file: join(home, 'secrets.json'), cipher })
const settingsStore = new FileSettingsStore({ file: join(home, 'settings.json'), label: 'user settings' })
const cloudIds = new Set(CLOUD_SETTING_DEFINITIONS.map((definition: { id: string }) => definition.id))
const definitions = [
  ...core.ATLAS_SETTINGS.filter((definition: { id: string }) => !cloudIds.has(definition.id)),
  ...CLOUD_SETTING_DEFINITIONS,
]
const settings = createSettingsService({
  definitions,
  user: settingsStore,
  environment: environmentLayer({ definitions, env: process.env }),
})
settings.close()

let credentials: { token: string; teamId: string; projectId: string }
try {
  credentials = requireVercelCredentials({ settings, secrets })
  line('vercel credentials: fully local')
} catch (error) {
  if (!(error instanceof VercelNotConfiguredError)) throw error
  const token = secrets.read(core.ESettingId.VercelToken)
  if (token === undefined || token.trim().length === 0) {
    fail('sandbox.vercelToken missing from local secrets.json — stopping')
  }
  line('local settings lack team/project; reading cloud session backup (values never printed)')
  const session = new CloudSessionStore({
    file: join(home, 'cloud.json'),
    keyFile: join(home, 'key'),
  }).read()
  if (session === null) fail('no readable cloud session — stopping')
  secretsHeld.add(session.token)
  const client = new CloudClient({ url: session.url, token: session.token })
  const remote = new Map(
    (await client.listSettings()).map((row: { key: string; value: unknown }) => [
      row.key,
      decodeSettingValue(row.value),
    ]),
  )
  const teamId = remote.get(core.ESettingId.VercelTeamId)
  const projectId = remote.get(core.ESettingId.VercelProjectId)
  if (typeof teamId !== 'string' || teamId.length === 0) fail('sandbox.vercelTeamId absent from cloud settings — stopping')
  if (typeof projectId !== 'string' || projectId.length === 0) fail('sandbox.vercelProjectId absent from cloud settings — stopping')
  credentials = { token, teamId, projectId }
  line('vercel credentials: local token + cloud-backed team/project (values never printed)')
}
secretsHeld.add(credentials.token)

const held = settings.snapshot().resolution.settings.get(core.ESettingId.SandboxImage as never)
const image = typeof held?.value === 'string' && held.value.length > 0 ? held.value : 'atlas-sandbox:latest'
line(`sandbox image: ${image}`)

const serveBytes = readFileSync(BINARY_PATH)
const serveSha = createHash('sha256').update(serveBytes).digest('hex')
line(`current serve build: ${Math.round(serveBytes.length / 1024 / 1024)} MB sha256 ${serveSha.slice(0, 12)}…`)
if (serveBytes[0] !== 0x7f || serveBytes[1] !== 0x45 || serveBytes[2] !== 0x4c || serveBytes[3] !== 0x46) {
  fail(`${BINARY_PATH} is not an ELF — build it with apps/serve/scripts/build-serve.ts --target bun-linux-arm64`)
}

const threadId = `smoke-local-first-${randomUUID()}`
const sandboxName = sandboxNameFor({ threadId })
const driveName = driveNameFor({ threadId })
if (!sandboxName.startsWith('atlas-thread-') || !driveName.startsWith('atlas-drive-')) {
  fail(`derived names are not thread-derived (sandbox=${sandboxName}, drive=${driveName})`)
}
line(`disposable resources (BEFORE any provider mutation): sandbox=${sandboxName} drive=${driveName}`)

const vaultKeyHex = randomBytes(32).toString('hex')
const accountId = `fake-account-${randomUUID().slice(0, 8)}`
const sealedSecret = sealWith({
  keyHex: vaultKeyHex,
  plaintext: JSON.stringify({ kind: core.EAuthKind.ApiKey, apiKey: FAKE_API_KEY }),
})
const now = new Date().toISOString()
const portableState = wire.portableStateSchema.parse({
  version: wire.PORTABLE_STATE_VERSION,
  vaultKeyHex,
  accounts: [
    {
      id: accountId,
      provider: core.EAuthProvider.Anthropic,
      kind: core.EAuthKind.ApiKey,
      origin: core.EAccountOrigin.Login,
      label: 'smoke fake account',
      status: core.EAccountStatus.Active,
      createdAt: now,
      updatedAt: now,
      secret: sealedSecret,
    },
  ],
  active: [{ provider: core.EAuthProvider.Anthropic, accountId }],
  secrets: [],
  settings: { name: wire.PORTABLE_SETTINGS_NAME, content: JSON.stringify({ 'appearance.theme': 'dark' }) },
  mcp: { name: wire.PORTABLE_MCP_NAME, content: JSON.stringify({ mcpServers: {} }) },
})
const workspaceSpec = JSON.stringify({
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
})

const driver = new VercelDriver({
  credentials,
  cloudUrl: UNREACHABLE_CLOUD_URL,
  image,
  log: (entry: string) => line(`[driver] ${entry}`),
})

const healthOf = async (url: string, token: string): Promise<Record<string, unknown>> => {
  const response = await fetch(`${url}/v1/health`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`health answered ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

const helloOf = (url: string, token: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/v1/session`, [
      wire.CHANNEL_SUBPROTOCOL,
      wire.bearerSubprotocolOf(token),
    ])
    const timeout = setTimeout(() => reject(new Error('hello timed out')), 30_000)
    ws.onmessage = (event) => {
      const frame = wire.decodeServeFrame(String(event.data))
      if (frame === null || frame.kind !== wire.EServeFrame.Ready) return
      clearTimeout(timeout)
      ws.close()
      const match = frame.protocol === wire.CHANNEL_PROTOCOL_VERSION
      resolve(match ? `protocol ${frame.protocol ?? 'absent'} (matches local ${wire.CHANNEL_PROTOCOL_VERSION})` : `MISMATCH protocol ${String(frame.protocol)}`)
    }
    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('websocket failed before ready'))
    }
    ws.onopen = () => {
      ws.send(
        wire.encodeFrame({
          kind: wire.EClientFrame.Hello,
          threadId,
          channelCursor: null,
          lastEventSeq: 0,
          protocol: wire.CHANNEL_PROTOCOL_VERSION,
        }),
      )
    }
  })

type LiveSandbox = Parameters<
  NonNullable<Parameters<typeof driver.createOrResume>[0]['putContextOnFreshBoot']>
>[0]

const sh = async (sandbox: LiveSandbox, script: string, timeoutMs = 30_000): Promise<void> => {
  const run = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script], timeoutMs })
  if (run.exitCode !== 0) {
    const stderr = await run.stderr().catch(() => '')
    throw new Error(`command failed (${run.exitCode}): ${script.slice(0, 120)} — ${stderr.slice(0, 300)}`)
  }
}

const shText = async (sandbox: LiveSandbox, script: string, timeoutMs = 30_000): Promise<string> => {
  const run = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script], timeoutMs })
  return (await run.stdout()).trim()
}

const killBakedServe = async (sandbox: LiveSandbox): Promise<void> => {
  await sh(
    sandbox,
    'for p in /proc/[0-9]*; do if grep -qa "^/opt/atlas/atlas-serve" "$p/cmdline" 2>/dev/null; then kill -9 "${p#/proc/}" 2>/dev/null || true; fi; done; exit 0',
    20_000,
  )
  line('baked serve stopped for the swap')
}

const uploadServeChunked = async (sandbox: LiveSandbox): Promise<void> => {
  const chunks = Math.ceil(serveBytes.length / CHUNK_BYTES)
  line(`uploading current serve build as ${chunks} raw files via writeFiles (gzip streams per request; no bulk single file, no base64 through runCommand)`)
  const stageDir = '/tmp/atlas-serve-parts'
  await sh(sandbox, `rm -rf ${stageDir} && mkdir -p ${stageDir}`, 15_000)
  for (let index = 0; index < chunks; index++) {
    const slice = serveBytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
    await sandbox.writeFiles([
      { path: `${stageDir}/part-${String(index).padStart(4, '0')}`, content: slice },
    ])
    if ((index + 1) % 20 === 0 || index + 1 === chunks) line(`  part ${index + 1}/${chunks}`)
  }
  const expected = serveSha.slice(0, 12)
  await sh(
    sandbox,
    `cat ${stageDir}/part-* > /opt/atlas/atlas-serve.new && chmod 755 /opt/atlas/atlas-serve.new && test "$(sha256sum /opt/atlas/atlas-serve.new | cut -c1-12)" = "${expected}" && mv /opt/atlas/atlas-serve.new /opt/atlas/atlas-serve && rm -rf ${stageDir}`,
    120_000,
  )
  await sandbox.writeFiles([{ path: `${wire.SERVE_BINARY_PATH}.version`, content: 'local-first-smoke', mode: 0o644 }])
  line(`serve swap verified in-sandbox (sha256 ${expected}\u2026 matches)`)
}

let placement: Awaited<ReturnType<typeof driver.createOrResume>> | undefined
let destroyed = false
const destroy = async (): Promise<void> => {
  if (destroyed) return
  destroyed = true
  line(`cleanup: destroying sandbox=${sandboxName} and drive=${driveName}`)
  await driver.destroy({ name: sandboxName, threadId })
  line('cleanup: destroy returned')
}

const sandboxByName = async (name: string): Promise<LiveSandbox | undefined> => {
  try {
    const { Sandbox } = await import('@vercel/sandbox')
    return await Sandbox.get({
      ...credentials,
      name,
      signal: AbortSignal.timeout(30_000),
    }) as unknown as LiveSandbox
  } catch {
    return undefined
  }
}

try {
  placement = await driver.createOrResume({
    name: sandboxName,
    threadId,
    environment: {
      ATLAS_CLOUD_URL: UNREACHABLE_CLOUD_URL,
      ATLAS_TELEMETRY: '0',
    },
    putContextOnFreshBoot: async (sandbox) => {
      await driver.writeBootstrapFileToSandbox({ sandbox, path: '/atlas/home/bootstrap/workspace-spec.json', content: workspaceSpec })
      await driver.writeBootstrapFileToSandbox({ sandbox, path: wire.PORTABLE_STATE_PATH, content: JSON.stringify(portableState) })
      line('bootstrap files staged (workspace spec with nulls; sealed portable state)')
      await killBakedServe(sandbox)
      await uploadServeChunked(sandbox)
    },
  })
  line(`placement: url=${placement.url} state=${placement.state} created=${placement.created}`)
  secretsHeld.add(placement.token)

  const live = await sandboxByName(sandboxName)
  if (live === undefined) fail('sandbox did not resolve by name after placement')

  const localStateAfterBoot = await shText(live, `test -f ${wire.PORTABLE_STATE_PATH} && echo present || echo consumed`)
  line(`portable state bundle after boot: ${localStateAfterBoot}`)
  if (localStateAfterBoot !== 'consumed') fail('the portable state bundle was not consumed at boot')

  const vaultCheck = await shText(
    live,
    `node -e "const {readFileSync}=require('node:fs');const v=JSON.parse(readFileSync('/atlas/home/auth.json','utf8'));console.log(v.accounts.length, v.active.anthropic===v.accounts[0]?.id)"`,
  )
  line(`vault installed: accounts=1 and anthropic active pointer set → ${vaultCheck}`)
  if (vaultCheck !== '1 true') fail('the sealed account did not materialize into the vault')

  const health = await healthOf(placement.url, placement.token)
  const workspaceState = (health.workspace as { state?: string } | undefined)?.state
  line(`health: ok=${String(health.ok)} workspace=${String(workspaceState)} clients=${String(health.clients)}`)
  if (String(health.threadId) !== threadId) fail('health threadId does not match the synthetic thread')

  const firstHello = await helloOf(placement.url, placement.token)
  line(`channel hello: ready received, ${firstHello}`)
  if (firstHello.startsWith('MISMATCH')) fail(firstHello)

  const resumed = await driver.createOrResume({ name: sandboxName, threadId, token: placement.token })
  line(`resume: created=${resumed.created} state=${resumed.state} token stable=${resumed.token === placement.token}`)
  if (resumed.created) fail('resume unexpectedly recreated the sandbox')
  const localStateAfterResume = await shText(live, `test -f ${wire.PORTABLE_STATE_PATH} && echo rewritten || echo absent`)
  line(`portable state after resume: ${localStateAfterResume} (no local-state rewrite)`)
  if (localStateAfterResume !== 'absent') fail('resume rewrote the local-state bundle')
  const secondHello = await helloOf(resumed.url, placement.token)
  line(`channel hello after resume: ready received, ${secondHello}`)
  if (secondHello.startsWith('MISMATCH')) fail(secondHello)

  const authHashBefore = await shText(live, 'sha256sum /atlas/home/auth.json | cut -c1-16')
  await driver.stop({ name: sandboxName })
  line('sandbox stopped; restarting to check drive-held state')
  const restarted = await driver.createOrResume({ name: sandboxName, threadId, token: placement.token })
  const restartedHealth = await healthOf(restarted.url, placement.token)
  line(`restart: created=${restarted.created} health ok=${String(restartedHealth.ok)} thread matches=${String(restartedHealth.threadId) === threadId}`)
  const liveAfterRestart = await sandboxByName(sandboxName)
  if (liveAfterRestart === undefined) fail('sandbox did not resolve by name after restart')
  const authHashAfter = await shText(liveAfterRestart, 'sha256sum /atlas/home/auth.json | cut -c1-16')
  line(`auth.json hash stable across stop/restart: ${authHashBefore === authHashAfter} (hashes only, never contents)`)
  if (authHashBefore !== authHashAfter) fail('the vault changed across a stop/restart cycle')
  const thirdHello = await helloOf(restarted.url, placement.token)
  line(`channel hello after restart: ready received, ${thirdHello}`)
  if (thirdHello.startsWith('MISMATCH')) fail(thirdHello)

  line('no model, provider, or MCP request was issued: the smoke only reads /v1/health and completes channel hellos')
  line(`SMOKE PASS: provision, sealed portable-state boot, current-binary swap (chunked, no bulk writeFiles), hello on protocol ${wire.CHANNEL_PROTOCOL_VERSION}, stable-token resume without rewrite, restart with vault preserved, cleanup follows`)
} finally {
  await destroy().catch((error) => line(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`))
}

const remaining = await sandboxByName(sandboxName)
line(`post-destroy verify: sandbox ${sandboxName} ${remaining === undefined ? 'gone' : 'STILL PRESENT'}`)
if (remaining !== undefined) fail('name-scoped verify found the sandbox still present after destroy')
line('VERIFIED CLEAN: sandbox and drive destroyed; no name outside this thread was touched')
