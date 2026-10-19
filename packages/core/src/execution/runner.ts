export enum ERunner {
  Local = 'local',
  Vercel = 'vercel',
}

export function runnerOf(value: string | null | undefined): ERunner | undefined {
  if (value === ERunner.Local) return ERunner.Local
  if (value === ERunner.Vercel) return ERunner.Vercel
  return undefined
}
