import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSession } from '../server/src/kdpClient.js'
import { getLoginState, startInteractiveLogin } from '../server/src/login.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const controller = process.env.REMOTE_GUI_CONTROLLER ??
  path.join(process.env.HOME ?? '', '.claude/skills/remote-gui/scripts/remote_gui.py')

async function worker(): Promise<void> {
  await startInteractiveLogin()
  while (getLoginState().loginInProgress) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const state = getLoginState()
  if (state.loginError) throw new Error(state.loginError)
  const result = await checkSession()
  if (!result.connected) throw new Error('Amazon login ended without a valid KDP session.')
}

function launcher(): void {
  const tsx = path.join(root, 'node_modules/.bin/tsx')
  const run = spawnSync('python3', [controller, 'start', '--json', '--', tsx,
    path.join(here, 'remote-login.ts'), 'worker'], { cwd: root, encoding: 'utf8' })
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout)
    process.exit(run.status ?? 1)
  }
  const session = JSON.parse(run.stdout)
  console.log(JSON.stringify({
    ...session,
    instruction: 'Open secret URL, then finish Amazon sign-in and MFA. Close tab when KDP loads.',
  }, null, 2))
}

if (process.argv[2] === 'worker') {
  worker().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
} else {
  launcher()
}
