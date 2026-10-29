import type { PortExposure } from '@dltech/atlas-core'

export function exposureClause({
  exposure,
}: {
  exposure: PortExposure | undefined
}): readonly string[] {
  if (exposure === undefined) return []
  if (exposure.hostPort === exposure.containerPort) {
    return [`It is reachable on the operator’s machine at ${exposure.url}.`]
  }

  return [
    `It is reachable on the operator’s machine at ${exposure.url}, where a proxy forwards to port ${exposure.containerPort} in the sandbox.`,
    'Bind the server to 0.0.0.0 so the proxy can reach it.',
    'Hand the operator the returned URL, never a localhost or sandbox-internal one.',
    'That name resolves only on the operator’s machine: a curl from inside the sandbox can never reach it, and a curl to localhost proves nothing about what the operator can open. Verify against the service’s in-sandbox address.',
    'Every port subdomain of the sandbox host is one site, so cookies and cross-origin fetch behave as they do on one production domain - wire related servers with the returned URLs, not localhost.',
  ]
}

export const exposureUnsupported = (): string =>
  'this execution mode cannot publish ports, so exposePort has nothing to bind'
