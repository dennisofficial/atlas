import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import {
  MemoryEditRefusedError,
  MemoryInvalidError,
  MemoryNotFoundError,
  MemoryStaleRevisionError,
  editMemory,
  getMemory,
  listAllMemories,
  listMemories,
  putMemory,
  removeMemory,
  type MemoryKey,
} from '@dltech/atlas-memory'
import type { EMemoryType, MemoryEntry, MemorySummary } from '@dltech/atlas-wire'

const asHttpException = (failure: unknown): never => {
  if (failure instanceof MemoryInvalidError) throw new BadRequestException(failure.message)
  if (failure instanceof MemoryNotFoundError) throw new NotFoundException(failure.message)
  if (failure instanceof MemoryStaleRevisionError) {
    throw new ConflictException({ message: failure.message, code: failure.code })
  }
  if (failure instanceof MemoryEditRefusedError) {
    throw new UnprocessableEntityException({ message: failure.message, code: failure.code })
  }
  throw failure
}

const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (failure) {
    return asHttpException(failure)
  }
}

@Injectable()
export class MemoriesService {
  list(args: { userId: string; project?: string | undefined }): Promise<MemorySummary[]> {
    return guarded(() => listMemories({ db, ...args }))
  }

  listAll(args: { userId: string }): Promise<MemorySummary[]> {
    return guarded(() => listAllMemories({ db, ...args }))
  }

  get(args: MemoryKey): Promise<MemoryEntry> {
    return guarded(() => getMemory({ db, ...args }))
  }

  put(
    args: MemoryKey & { description: string; type: EMemoryType; body: string },
  ): Promise<MemorySummary> {
    return guarded(() => putMemory({ db, ...args }))
  }

  edit(
    args: MemoryKey & { old: string; replacement: string; revision: number },
  ): Promise<MemorySummary> {
    return guarded(() => editMemory({ db, ...args }))
  }

  remove(args: MemoryKey): Promise<void> {
    return guarded(() => removeMemory({ db, ...args }))
  }
}
