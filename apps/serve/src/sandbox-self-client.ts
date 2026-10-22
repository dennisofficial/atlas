export async function postSandboxSelf(args: {
  controlPlaneUrl: string
  path: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  body: unknown
}): Promise<Response> {
  const response = await args.fetchFn(`${args.controlPlaneUrl.replace(/\/+$/, '')}${args.path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.token}`,
      'content-type': 'application/json',
      'atlas-client-version': args.clientVersion,
    },
    body: JSON.stringify(args.body),
  })
  if (!response.ok) {
    throw new Error(
      `the control plane answered ${response.status}: ${await response.text().catch(() => '')}`,
    )
  }
  return response
}
