export enum EThreadTitleSource {
  User = 'user',
  Auto = 'auto',
}

export type LocalTitleState = {
  title: string | null
  source: EThreadTitleSource | null
  revision: number
}

export function localTitleStateOf(meta: {
  title: string | null
  titleSource?: EThreadTitleSource | undefined
  titleRevision?: number | undefined
}): LocalTitleState {
  return {
    title: meta.title,
    source: meta.titleSource ?? null,
    revision: meta.titleRevision ?? 0,
  }
}
