export const USER_FILE_TREES = ['skills', 'instructions', 'memory'] as const

export type UserFileTree = (typeof USER_FILE_TREES)[number]

export interface UserFileDto {
  path: string
  revision: number
  contentHash: string
  tombstonedAt: string | null
}

export interface UserFileWithContentDto extends UserFileDto {
  content: string | null
}

export interface UserFileListDto {
  files: UserFileDto[]
}

export interface UserFileContentListDto {
  files: UserFileWithContentDto[]
}

export interface UserFileRevisionDto {
  revision: number
}
