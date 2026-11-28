export enum EIconPart {
  Body = 'body',
  Glyph = 'glyph',
}

export type IconPath = {
  d: string
  fill: string | null
  part: EIconPart
  fillRule?: 'evenodd'
}

export type IconArt = {
  viewBox: string
  paths: IconPath[]
  open?: IconPath[]
}
