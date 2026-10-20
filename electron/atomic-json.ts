import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

type RenameOperations = {
  rename?: (source: string, target: string) => Promise<void>
  wait?: (milliseconds: number) => Promise<void>
}

const retryDelays = [25, 50, 100, 200, 400] as const
const retryableCodes = new Set(['EPERM', 'EACCES', 'EBUSY'])

async function renameWithRetry(source: string, target: string, operations: RenameOperations) {
  const rename = operations.rename ?? fs.rename
  const pause = operations.wait ?? wait
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      if (!retryableCodes.has((error as NodeJS.ErrnoException)?.code ?? '') || attempt >= retryDelays.length) throw error
      await pause(retryDelays[attempt])
    }
  }
}

export async function writeJsonAtomically(file: string, value: unknown, operations: RenameOperations = {}) {
  const directory = path.dirname(file)
  await fs.mkdir(directory, { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await renameWithRetry(temporary, file, operations)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
