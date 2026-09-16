export enum EExecutionLocation {
  Host = 'host',
  Docker = 'docker',
  Cloud = 'cloud',
}

export function executionLocationOf(
  value: string | null | undefined,
): EExecutionLocation | undefined {
  if (value === EExecutionLocation.Host) return EExecutionLocation.Host
  if (value === EExecutionLocation.Docker) return EExecutionLocation.Docker
  if (value === EExecutionLocation.Cloud) return EExecutionLocation.Cloud
  return undefined
}
