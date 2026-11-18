import { z } from 'zod'

export enum EChangeFileStatus {
  Added = 'added',
  Modified = 'modified',
  Deleted = 'deleted',
}

export enum EChangeSide {
  Base = 'base',
  Current = 'current',
}

export const changeFileStatusSchema = z.enum(EChangeFileStatus)

export const changeSideSchema = z.enum(EChangeSide)
