import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { SESSION_DIR } from './config.js'
import { atomicPrivateJson, withPrivateLock, resolveSystemCommand } from './privateState.js'

export class EgressError extends Error {
  readonly code = 'egress_down'
  constructor(message: string) { super(message); this.name = 'EgressError' }
}
export type EgressConfig = { sshHost: string; sshUser: string; sshPort: number; socksPort: number; expectedIp?: string }
export const egressConfigPath = () => process.env.KDP_EGRESS_CONFIG || path.join(SESSION_DIR, 'egress.json')

export function validateEgressConfig(value: unknown): EgressConfig {
  const c = value as EgressConfig
  if (!c || typeof c.sshHost !== 'string' || typeof c.sshUser !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(c.sshHost) || !/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(c.sshUser) ||
    !Number.isInteger(c.sshPort) || c.sshPort < 1 || c.sshPort > 65535 ||
    !Number.isInteger(c.socksPort) || c.socksPort < 1024 || c.socksPort > 65535 ||
    (c.expectedIp !== undefined && !net.isIP(c.expectedIp))) throw new EgressError('Invalid SSH egress configuration. Direct fallback is disabled.')
  return c
}
export async function readEgressConfig(): Promise<EgressConfig> {
  try { return validateEgressConfig(JSON.parse(await fs.readFile(egressConfigPath(), 'utf8'))) }
  catch (e) { if (e instanceof EgressError) throw e; throw new EgressError(`Cannot read ${egressConfigPath()}. Configure owned SSH endpoint before KDP login. Direct fallback is disabled.`) }
}
export function sshTunnelArgs(c: EgressConfig): string[] {
  return ['-4', '-N', '-D', `127.0.0.1:${c.socksPort}`, '-p', String(c.sshPort),
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    `${c.sshUser}@${c.sshHost}`]
}
function fingerprint(c: EgressConfig) { return `${c.sshUser}@${c.sshHost}:${c.sshPort}/${c.socksPort}` }

export async function socksReady(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let data = Buffer.alloc(0)
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok) }
    socket.setTimeout(800, () => finish(false))
    socket.on('error', () => finish(false))
    socket.on('connect', () => socket.write(Buffer.from([5, 1, 0])))
    socket.on('data', chunk => { data = Buffer.concat([data, chunk]); if (data.length >= 2) finish(data[0] === 5 && data[1] === 0) })
  })
}
async function processIdentity(pid: number): Promise<string | null> {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] // Linux starttime, prevents PID reuse.
  } catch { return null }
}

/** Reuse only our recorded SSH process. Never adopt another listener or switch to direct. */
export async function ensureEgress(): Promise<{ server: string; config: EgressConfig }> {
  const c = await readEgressConfig()
  await withPrivateLock(path.join(SESSION_DIR, 'egress.lock'), async () => {
    const statePath = path.join(SESSION_DIR, 'egress-process.json')
    let state: { pid: number; identity: string; target: string } | undefined
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')) } catch { /* first start */ }
    if (state && state.target === fingerprint(c) && state.identity === await processIdentity(state.pid) && await socksReady(c.socksPort)) return
    if (await socksReady(c.socksPort)) throw new EgressError('SOCKS port already belongs to another or differently configured process. Stop it explicitly; no automatic route switch.')
    // A live recorded process may still be connecting; do not start duplicate tunnels.
    if (state && state.identity === await processIdentity(state.pid)) throw new EgressError('Recorded SSH tunnel is alive but unavailable. Wait or inspect tunnel; no direct fallback.')
    const ssh = await resolveSystemCommand('ssh')
    const log = await fs.open(path.join(SESSION_DIR, 'egress-ssh.log'), 'a', 0o600)
    const child = spawn(ssh, sshTunnelArgs(c), { detached: true, stdio: ['ignore', 'ignore', log.fd] })
    let launchError = false
    child.on('error', () => { launchError = true })
    let exited = false
    child.once('exit', () => { exited = true })
    try {
      for (let attempt = 0; attempt < 100 && !exited && !launchError; attempt++) {
        if (child.pid && await socksReady(c.socksPort)) {
          const identity = await processIdentity(child.pid)
          if (!identity) break
          await atomicPrivateJson(statePath, { pid: child.pid, identity, target: fingerprint(c) })
          child.unref()
          return
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new EgressError('SSH tunnel could not start. Check endpoint, trusted host key, key authentication and egress-ssh.log. No Amazon request sent; no direct fallback.')
    } catch (e) { child.kill('SIGTERM'); throw e }
    finally { await log.close() }
  })
  return { server: `socks5://127.0.0.1:${c.socksPort}`, config: c }
}

/** First successful owned-SSH route is pinned. Later IP changes stop operations. */
export async function verifyEgressIp(config: EgressConfig, browserIp: string, requestIp: string): Promise<void> {
  if (!net.isIP(browserIp) || browserIp !== requestIp) throw new EgressError('Browser and API request egress disagree. Stop; do not log in or upload.')
  await withPrivateLock(path.join(SESSION_DIR, 'egress-ip.lock'), async () => {
    const file = path.join(SESSION_DIR, 'egress-ip.json')
    let pinned: { target: string; ip: string } | undefined
    try { pinned = JSON.parse(await fs.readFile(file, 'utf8')) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new EgressError('Egress IP pin is unreadable. Stop and inspect it.') }
    if (pinned && (pinned.target !== fingerprint(config) || pinned.ip !== browserIp)) throw new EgressError('SSH route or residential exit IP changed. Inspect before resetting egress-ip.json; no automatic IP rotation.')
    if (config.expectedIp && config.expectedIp !== browserIp) throw new EgressError('SSH exit IP differs from configured expectedIp.')
    await atomicPrivateJson(file, { target: fingerprint(config), ip: browserIp, verifiedAt: new Date().toISOString() })
  })
}

/** Local health only: never launches browser, starts SSH or contacts Amazon. */
export async function readEgressStatus() {
  try {
    const config = await readEgressConfig()
    const state = JSON.parse(await fs.readFile(path.join(SESSION_DIR, 'egress-process.json'), 'utf8'))
    const pin = JSON.parse(await fs.readFile(path.join(SESSION_DIR, 'egress-ip.json'), 'utf8'))
    const ready = pin.target === fingerprint(config) && (!config.expectedIp || pin.ip === config.expectedIp) && state.target === fingerprint(config) && state.identity === await processIdentity(state.pid) && await socksReady(config.socksPort)
    return { required: true, ready, socksPort: config.socksPort, exitIp: pin.ip, verifiedAt: pin.verifiedAt ?? null }
  } catch { return { required: true, ready: false } }
}
