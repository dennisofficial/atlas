export enum EExecutionLocation {
  Cloud = 'cloud',
}

export function executionLocationOf(
  value: string | null | undefined,
): EExecutionLocation | undefined {
  return value === EExecutionLocation.Cloud ? EExecutionLocation.Cloud : undefined
}
