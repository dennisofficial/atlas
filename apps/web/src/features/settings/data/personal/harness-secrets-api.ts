import { api, cloudCall } from '@/lib/api-client'

export async function fetchHarnessSecretNames(): Promise<string[]> {
  const body = await cloudCall(api.harnessSecrets.names.query())
  return body.names
}

export function putHarnessSecret(args: { name: string; value: string }): Promise<void> {
  return cloudCall(api.harnessSecrets.set.mutate({ name: args.name, value: args.value }))
}
