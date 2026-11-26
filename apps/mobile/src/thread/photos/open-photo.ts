import { router } from 'expo-router'

import { type Photo, putPhoto } from './photo-store'

export const openPhoto = (photo: Photo) =>
  router.push({ pathname: '/photo', params: { id: putPhoto(photo) } })
