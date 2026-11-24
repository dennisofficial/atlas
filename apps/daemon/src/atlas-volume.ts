const ATLAS_MOUNT_POINT = '/atlas'

export const isAtlasVolumeMounted = (mountsText: string): boolean =>
  mountsText.split('\n').some((line) => line.split(' ')[1] === ATLAS_MOUNT_POINT)
