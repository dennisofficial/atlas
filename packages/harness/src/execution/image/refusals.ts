export enum EConfigRefusal {
  NotJson = 'not-json',
  BadShape = 'bad-shape',
  Unreadable = 'unreadable',
  MountRelative = 'mount-relative',
  MountDotDot = 'mount-dot-dot',
  MountOverLong = 'mount-over-long',
  MountReserved = 'mount-reserved',
  DockerfileWithImage = 'dockerfile-with-image',
  DockerfileEscapes = 'dockerfile-escapes',
}

export type ConfigRefusal = {
  refusal: EConfigRefusal
  file: string
  detail: string
}
