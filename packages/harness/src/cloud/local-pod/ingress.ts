import { posix } from 'node:path'

import type { DockerPodEngine } from '../../execution/docker/pod-engine'
import { proxyScriptSource } from './ingress-script'

export const POD_INGRESS_CONTAINER_PORT = 7676

export const POD_INGRESS_SCRIPT_PATH = '/opt/atlas-ingress/proxy.mjs'

export const POD_INGRESS_LOG_PATH = '/tmp/atlas-ingress.log'

export type PodIngressEngine = Pick<DockerPodEngine, 'execSh' | 'writeFile'>

const EXEC_TIMEOUT_MS = 15_000
const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 200
const LOG_TAIL_LINES = 20

const PROBE_SCRIPT = `curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:${POD_INGRESS_CONTAINER_PORT}/`

const PREPARE_SCRIPT = `mkdir -p ${posix.dirname(POD_INGRESS_SCRIPT_PATH)}`

const LAUNCH_SCRIPT =
  `ATLAS_PROXY_TARGET=127.0.0.1 setsid nohup node ${POD_INGRESS_SCRIPT_PATH} ` +
  `>${POD_INGRESS_LOG_PATH} 2>&1 </dev/null &`

const isListening = async (args: {
  engine: PodIngressEngine
  id: string
  timeoutMs: number
}): Promise<boolean> => {
  const probe = await args.engine
    .execSh({ id: args.id, script: PROBE_SCRIPT, timeoutMs: args.timeoutMs })
    .catch(() => undefined)
  return probe?.exitCode === 0
}

const logTail = async (args: { engine: PodIngressEngine; id: string }): Promise<string> => {
  const tail = await args.engine
    .execSh({
      id: args.id,
      script: `tail -n ${LOG_TAIL_LINES} ${POD_INGRESS_LOG_PATH} 2>&1`,
      timeoutMs: EXEC_TIMEOUT_MS,
    })
    .catch(() => undefined)
  return tail === undefined ? '' : (await tail.stdout()).trim()
}

export async function ensurePodIngress(args: {
  engine: PodIngressEngine
  id: string
  ingressHostPort: number
}): Promise<void> {
  if (await isListening({ ...args, timeoutMs: EXEC_TIMEOUT_MS })) return

  await args.engine.execSh({ id: args.id, script: PREPARE_SCRIPT, timeoutMs: EXEC_TIMEOUT_MS })
  await args.engine.writeFile({
    id: args.id,
    path: POD_INGRESS_SCRIPT_PATH,
    content: proxyScriptSource({
      hostPort: args.ingressHostPort,
      containerPort: POD_INGRESS_CONTAINER_PORT,
    }),
    mode: 0o644,
  })
  await args.engine.execSh({ id: args.id, script: LAUNCH_SCRIPT, timeoutMs: EXEC_TIMEOUT_MS })

  const deadline = Date.now() + READY_TIMEOUT_MS
  for (let remaining = READY_TIMEOUT_MS; remaining > 0; remaining = deadline - Date.now()) {
    if (await isListening({ ...args, timeoutMs: remaining })) return
    await Bun.sleep(Math.min(READY_POLL_MS, Math.max(0, deadline - Date.now())))
  }

  throw new Error(
    `the pod ingress proxy did not answer on port ${POD_INGRESS_CONTAINER_PORT} within ${READY_TIMEOUT_MS}ms: ${await logTail(args)}`,
  )
}
