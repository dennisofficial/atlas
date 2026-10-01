import { ThreadStorePort } from '../../../store/thread-store'
import type { FakeThreadStore } from './fake-backend'

export class WatchedThreadStore extends ThreadStorePort {
  private readonly inner: FakeThreadStore
  private readonly trail: string[]

  constructor(args: { inner: FakeThreadStore; trail: string[] }) {
    super()
    this.inner = args.inner
    this.trail = args.trail
  }

  create(args: Parameters<ThreadStorePort['create']>[0]) {
    return this.inner.create(args)
  }

  createWithFirstEvents(args: Parameters<ThreadStorePort['createWithFirstEvents']>[0]) {
    this.trail.push('transfer')
    return this.inner.createWithFirstEvents(args)
  }

  find(args: Parameters<ThreadStorePort['find']>[0]) {
    return this.inner.find(args)
  }

  spawned(args: Parameters<ThreadStorePort['spawned']>[0]) {
    return this.inner.spawned(args)
  }

  mostRecent(args: Parameters<ThreadStorePort['mostRecent']>[0]) {
    return this.inner.mostRecent(args)
  }

  list(args: Parameters<ThreadStorePort['list']>[0]) {
    return this.inner.list(args)
  }

  findNamed(args: Parameters<ThreadStorePort['findNamed']>[0]) {
    return this.inner.findNamed(args)
  }

  rename(args: Parameters<ThreadStorePort['rename']>[0]) {
    return this.inner.rename(args)
  }

  chooseModel(args: Parameters<ThreadStorePort['chooseModel']>[0]) {
    return this.inner.chooseModel(args)
  }

  chooseExecutionLocation(args: Parameters<ThreadStorePort['chooseExecutionLocation']>[0]) {
    this.trail.push('flip')
    return this.inner.chooseExecutionLocation(args)
  }

  adopt(args: Parameters<ThreadStorePort['adopt']>[0]) {
    return this.inner.adopt(args)
  }

  rewind(args: Parameters<ThreadStorePort['rewind']>[0]) {
    return this.inner.rewind(args)
  }

  compact(args: Parameters<ThreadStorePort['compact']>[0]) {
    return this.inner.compact(args)
  }

  summarise(args: Parameters<ThreadStorePort['summarise']>[0]) {
    return this.inner.summarise(args)
  }

  fork(args: Parameters<ThreadStorePort['fork']>[0]) {
    return this.inner.fork(args)
  }
}
