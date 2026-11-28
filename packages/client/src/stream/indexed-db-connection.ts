import { SESSION_LOG_STRUCTURE_VERSION } from './session-log'
import type { IdbDatabase, IdbFactory } from './indexed-db-types'

export const SESSION_LOG_DB = 'atlas-stream'
export const SESSION_LOG_EVENTS_STORE = 'events'
export const SESSION_LOG_SNAPSHOTS_STORE = 'snapshots'
export const SESSION_LOG_LEGACY_STORES = ['windows'] as const

const openDatabase = (factory: IdbFactory): Promise<IdbDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(SESSION_LOG_DB, SESSION_LOG_STRUCTURE_VERSION)
    let failed = false
    request.onupgradeneeded = () => {
      const db = request.result
      for (const legacy of SESSION_LOG_LEGACY_STORES) {
        if (db.objectStoreNames.contains(legacy)) db.deleteObjectStore(legacy)
      }
      if (!db.objectStoreNames.contains(SESSION_LOG_EVENTS_STORE)) {
        db.createObjectStore(SESSION_LOG_EVENTS_STORE, { keyPath: ['sessionId', 'seq'] })
      }
      if (!db.objectStoreNames.contains(SESSION_LOG_SNAPSHOTS_STORE)) {
        db.createObjectStore(SESSION_LOG_SNAPSHOTS_STORE, { keyPath: 'sessionId' })
      }
    }
    request.onsuccess = () => {
      if (failed) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => {
      failed = true
      reject(request.error)
    }
    request.onblocked = () => {
      failed = true
      reject(new Error('session log blocked'))
    }
  })

export const createSessionLogDatabase = (factory: IdbFactory): (() => Promise<IdbDatabase>) => {
  let held: Promise<IdbDatabase> | undefined
  return () => {
    if (held !== undefined) return held
    const pending = openDatabase(factory)
      .then((db) => {
        const invalidate = (): void => {
          if (held === pending) held = undefined
        }
        db.onclose = invalidate
        db.onversionchange = () => {
          invalidate()
          db.close()
        }
        return db
      })
      .catch((error: unknown) => {
        if (held === pending) held = undefined
        throw error
      })
    held = pending
    return pending
  }
}
