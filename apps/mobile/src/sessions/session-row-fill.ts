export interface IRowFill {
  color: 'foreground' | 'sidebarAccent'
  alpha: number
}

export const rowFillOf = ({
  dark,
}: {
  dark: boolean
}): { selected: IRowFill; pressed: IRowFill } =>
  dark
    ? {
        selected: { color: 'sidebarAccent', alpha: 1 },
        pressed: { color: 'sidebarAccent', alpha: 0.7 },
      }
    : {
        selected: { color: 'foreground', alpha: 0.2 },
        pressed: { color: 'foreground', alpha: 0.1 },
      }
