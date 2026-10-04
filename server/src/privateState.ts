import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

export class OperationBusyError extends Error {
  readonly code = 'operation_busy'
  constructor() { super('Another KDP operation owns session lock. Wait for it to finish.'); this.name = 'OperationBusyError' }
}

export async function atomicPrivateJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temp, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    await fs.rename(temp, file)
  } finally { await fs.unlink(temp).catch(() => {}) }
}

/** Kernel lock releases on crash. Child owns lock until parent closes stdin. */
export async function withPrivateLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const handle = await fs.open(file, 'a', 0o600)
  await handle.chmod(0o600)
  await handle.close()
  const gate = spawn('flock', ['-n', '-E', '75', file, process.execPath, '-e',
    'process.stdout.write("locked\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'],
    { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Session lock helper timed out.')), 5000)
      gate.once('error', error => { clearTimeout(timer); reject(error) })
      gate.once('exit', code => { clearTimeout(timer); reject(code === 75 ? new OperationBusyError() : new Error(`Session lock helper exited (${code}).`)) })
      gate.stdout.once('data', () => { clearTimeout(timer); resolve() })
    })
    return await fn()
  } finally {
    if (gate.exitCode === null && gate.signalCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { gate.kill('SIGTERM'); resolve() }, 1000)
        gate.once('exit', () => { clearTimeout(timer); resolve() })
        gate.stdin.end()
      })
    }
  }
}
