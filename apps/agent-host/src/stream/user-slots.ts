import type { UserSlots } from './stream-connection'

export const createUserSlots = (args: { limit: number }): UserSlots => {
  const held = new Map<string, number>()
  return {
    acquire: (userId) => {
      const count = held.get(userId) ?? 0
      if (count >= args.limit) return false
      held.set(userId, count + 1)
      return true
    },
    release: (userId) => {
      const count = held.get(userId) ?? 0
      if (count <= 1) held.delete(userId)
      else held.set(userId, count - 1)
    },
  }
}
