'use client'

import {
  useVercelCredentialSource,
  type VercelCredentialResource,
} from '../workspace/vercel-credential-resource'
import {
  deleteUserVercelCredential,
  getUserVercelCredential,
  putUserVercelCredential,
} from './vercel-credential-api'

const USER_SOURCE = {
  key: 'user-vercel-credential',
  load: getUserVercelCredential,
  put: putUserVercelCredential,
  remove: deleteUserVercelCredential,
}

export const useUserVercelCredential = (): VercelCredentialResource =>
  useVercelCredentialSource(USER_SOURCE)
