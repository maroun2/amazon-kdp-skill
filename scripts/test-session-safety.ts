import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { BrowserContext, Locator } from 'playwright'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kdp-safety-'))
process.env.KDP_SESSION_DIR = dir
process.env.KDP_EGRESS_CONFIG = path.join(dir, 'egress.json')
const { atomicPrivateJson, withPrivateLock, OperationBusyError } = await import('../server/src/privateState.js')
const { reserveInWindow, reserveUpload, uploadFile, UploadLimitError, UPLOAD_WINDOW_MS } = await import('../server/src/uploadQuota.js')
const { validateEgressConfig, sshTunnelArgs, ensureEgress, EgressError, verifyEgressIp } = await import('../server/src/egress.js')
const { saveSession, sessionFilePath, withSessionOperation } = await import('../server/src/session.js')
const config = { sshHost: 'owned.example', sshUser: 'owner', sshPort: 22, socksPort: 11081 }

test.after(async () => { await fs.rm(dir, { recursive: true, force: true }) })

test('missing and invalid route stop before SSH or Amazon traffic', async () => {
  await assert.rejects(ensureEgress(), EgressError)
  for (const bad of [{}, {...config, sshHost:'-oProxyCommand=bad'}, {...config, socksPort: 0}, {...config, expectedIp:'not-ip'}]) {
    assert.throws(() => validateEgressConfig(bad), EgressError)
  }
  const args = sshTunnelArgs(config)
  assert.ok(args.includes('127.0.0.1:11081'))
  for (const guard of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ExitOnForwardFailure=yes', 'ServerAliveCountMax=3']) assert.ok(args.includes(guard))
})

test('IP mismatch or changed exit stops and preserves pin', async () => {
  await assert.rejects(verifyEgressIp(config, '193.0.0.1', '193.0.0.2'), EgressError)
  await verifyEgressIp(config, '193.0.0.1', '193.0.0.1')
  await assert.rejects(verifyEgressIp(config, '193.0.0.2', '193.0.0.2'), EgressError)
  await assert.rejects(verifyEgressIp({...config, sshHost:'other.example'}, '193.0.0.1', '193.0.0.1'), EgressError)
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'egress-ip.json'),'utf8')).ip,'193.0.0.1')
})

test('atomic save keeps cookies, localStorage and IndexedDB private', async () => {
  await atomicPrivateJson(sessionFilePath(), { original:true })
  const state = { cookies:[{name:'refreshed',value:'synthetic'}], origins:[{origin:'https://fixture.example',localStorage:[{name:'test',value:'value'}],indexedDB:[]}] }
  const context = { storageState: async (options: unknown) => { assert.deepEqual(options, {indexedDB:true}); return state } } as unknown as BrowserContext
  await withSessionOperation(() => saveSession(context))
  assert.deepEqual(JSON.parse(await fs.readFile(sessionFilePath(),'utf8')),state)
  assert.equal((await fs.stat(sessionFilePath())).mode & 0o777, 0o600)
  const before = await fs.readFile(sessionFilePath(),'utf8')
  await assert.rejects(withSessionOperation(async () => { throw new Error('auth redirect') }))
  assert.equal(await fs.readFile(sessionFilePath(),'utf8'), before)
  assert.deepEqual((await fs.readdir(dir)).filter(n=>n.endsWith('.tmp')),[])
})

test('kernel lock excludes concurrent operations and releases on failure', async () => {
  await withSessionOperation(async () => {
    await assert.rejects(withSessionOperation(async () => {}), OperationBusyError)
  })
  await assert.rejects(withSessionOperation(async () => { throw new Error('fixture') }))
  await withSessionOperation(async () => {})
})

test('lock excludes separate process and releases after child crash', async () => {
  const lock = path.join(dir,'cross-process.lock')
  const holder = spawn('flock',['-F','-n',lock,process.execPath,'-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']})
  await new Promise<void>((resolve,reject)=>{ holder.stdout.once('data',()=>resolve()); holder.once('error',reject) })
  try { await assert.rejects(withPrivateLock(lock,async()=>{}),OperationBusyError) }
  finally {
    const exited = new Promise<void>(resolve => holder.once('exit',()=>resolve()))
    holder.kill('SIGKILL')
    await exited
  }
  await withPrivateLock(lock,async()=>{})
})

test('rolling hour blocks 21st upload, frees exact boundary, rejects clock rollback', () => {
  const now = 2*UPLOAD_WINDOW_MS
  const full = Array.from({length:20},(_,i)=>now-1000+i)
  assert.throws(()=>reserveInWindow(full,now),UploadLimitError)
  assert.equal(reserveInWindow([now-UPLOAD_WINDOW_MS,...full.slice(1)],now).length,20)
  assert.throws(()=>reserveInWindow([now+1],now),/backwards/)
  assert.throws(()=>reserveInWindow([NaN],now),/invalid/)
})

test('failed transfer counts, ledger survives restarts, corrupt ledger blocks', async () => {
  const input = {setInputFiles: async () => { throw new Error('uncertain transfer') }} as unknown as Locator
  await assert.rejects(uploadFile(input,'fixture.pdf'),/uncertain transfer/)
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'uploads.json'),'utf8')).length,1)
  for (let i=1;i<20;i++) await reserveUpload()
  await assert.rejects(reserveUpload(),UploadLimitError)
  await fs.writeFile(path.join(dir,'uploads.json'),'broken')
  await assert.rejects(reserveUpload(),SyntaxError)
})

test('real browser refreshes request cookies; auth redirect, parser failure and challenge preserve last state', async () => {
  const http = await import('node:http')
  const {chromium} = await import('playwright')
  const {resolveChromiumExecutablePath} = await import('../server/src/browserLaunch.js')
  const {withRefreshedState} = await import('../server/src/savedBrowser.js')
  const fixture = http.createServer((req,res)=> {
    if (req.url === '/refresh') res.setHeader('Set-Cookie','fixture=fresh; Path=/; HttpOnly')
    res.end('fixture')
  })
  await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve))
  const address = fixture.address() as {port:number}
  const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({headless:true,executablePath:resolveChromiumExecutablePath()!,args:['--no-sandbox']})
  try {
    const context = await browser.newContext()
    await withRefreshedState(context, async c => { await c.request.get(`${origin}/refresh`); const p=await c.newPage(); await p.goto(origin); await p.evaluate(()=>localStorage.setItem('test','fresh')) })
    const saved = await fs.readFile(sessionFilePath(),'utf8')
    const state = JSON.parse(saved)
    assert.equal(state.cookies.find((c:{name:string})=>c.name==='fixture').value,'fresh')
    assert.equal(state.origins[0].localStorage[0].value,'fresh')
    for (const url of ['/ap/signin','/captcha']) {
      const failed = await browser.newContext()
      await assert.rejects(withRefreshedState(failed,async c=>{ await (await c.newPage()).goto(origin+url) }))
      assert.equal(await fs.readFile(sessionFilePath(),'utf8'),saved)
      await failed.close()
    }
    await assert.rejects(withRefreshedState(context,async()=>{throw new Error('schema changed')}))
    assert.equal(await fs.readFile(sessionFilePath(),'utf8'),saved)
  } finally { await browser.close(); await new Promise<void>(resolve=>fixture.close(()=>resolve())) }
})
