// 만든 설치 파일을 한글·공백이 든 폴더에 풀어 AI 앱처럼 켜 본다 (CI 전용, npm run pack·pack:chatgpt 다음).
// LearnUs에는 접속하지 않는다: 서버는 fetch를 막은 채로 띄우고, 로그인 정보가 없거나 실패 표시가 있으면
// 첫 요청 전에 멈추는 것까지만 본다. 맥·윈도우는 OS 금고에 가짜 값을 쓰고·읽고·지운다
// (개인 컴퓨터의 실제 항목을 지우지 않게 CI에서만).
import { type ChildProcess, execFile, execFileSync, spawn, spawnSync } from 'node:child_process'
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { helperHarness } from './helper-harness.ts'

if (process.env.GITHUB_ACTIONS !== 'true') {
  console.error('GitHub Actions에서만 실행합니다 (OS 금고에 가짜 값을 쓰고 지웁니다).')
  process.exit(1)
}

const win = process.platform === 'win32'
const linux = process.platform === 'linux'
// Git의 GNU tar는 zip을 못 읽는다 → 윈도우 기본 tar.exe(bsdtar). 리눅스는 unzip.
const tar = win ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

function unpack(archive: string, into: string) {
  const list = linux
    ? execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    : execFileSync(tar, ['-tf', archive], { encoding: 'utf8' })
  // 탐색기 '압축 풀기'도 그대로 풀 수 있는 이름만: ./ 접두어·절대 경로·..·역슬래시 없음
  const bad = list
    .split(/\r?\n/)
    .filter((name) => /^(\.\/|\/|[A-Za-z]:)|\\|(^|\/)\.\.(\/|$)/.test(name))
  assert.deepEqual(bad, [], `${archive}: 압축 항목 이름이 이상합니다`)
  mkdirSync(into, { recursive: true })
  // tar.exe는 인자를 ANSI 코드 페이지로 받아 한글 경로를 -C로 못 넘긴다 → 풀 곳을 작업 폴더로
  if (linux) execFileSync('unzip', ['-q', archive, '-d', into])
  else execFileSync(tar, ['-xf', archive], { cwd: into })
}

const text = (result: unknown) =>
  ((result as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? '').join('\n')

// 서버의 fetch를 막는다: 무엇이 잘못돼도 스모크가 학교에 요청을 보내지 못하게
const blocker = join(mkdtempSync(join(tmpdir(), 'learnus-block-')), 'block.cjs')
writeFileSync(blocker, "globalThis.fetch = () => Promise.reject(new Error('network blocked'))\n")
const NO_NETWORK = { NODE_OPTIONS: `--require ${blocker.split(sep).join('/')}` }

/** stdio로 서버를 띄워 도구 10개, 도움말, list_courses가 학교 접속 전에 멈추며 내는 안내를 본다. */
async function session(label: string, command: string, args: string[], expected: string) {
  const client = new Client({ name: 'learnus-smoke', version: '0' })
  // SDK는 PATH 같은 기본값에 env를 더해 넘긴다 (LEARNUS_* 없음)
  const transport = new StdioClientTransport({ command, args, env: NO_NETWORK, stderr: 'inherit' })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    assert.equal(tools.length, 10, `${label}: 도구 수`)
    const help = await client.callTool({ name: 'learnus_help', arguments: {} })
    assert.ok(!help.isError && text(help).includes('LearnUs(비공식)'), `${label}: 도움말`)
    const courses = await client.callTool({ name: 'list_courses', arguments: {} })
    const first = text(courses).split('\n')[0]
    assert.ok(courses.isError && first.includes(expected), `${label}: ${first}`)
  } finally {
    await client.close()
  }
  console.log(`✔ ${label}: 도구 10개, 도움말, '${expected}'`)
}

type Vault = (
  mode: string,
  operation: string,
  input?: string,
) => { status: string; credentials?: Record<string, string> }

/** 헬퍼 대역으로 금고를 서버처럼 부른다. 값은 출력하지 않는다 (JSON 오류 문구에도 원문이 섞이지 않게). */
function vaultOf(call: ReturnType<typeof helperHarness>): Vault {
  return (mode, operation, input = '') => {
    const r = call(mode, operation, input)
    assert.equal(r.status, 0, `금고 헬퍼 ${operation} 실패`)
    try {
      return JSON.parse(r.stdout)
    } catch {
      throw new Error(`금고 헬퍼 ${operation}의 출력이 JSON이 아닙니다`)
    }
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 300 && !check(); i++) await sleep(100)
  assert.ok(check(), label)
}

// 헬퍼와 같은 잠금을 쥐고 'locked'를 알린 뒤 신호 파일을 기다린다 (stdin은 쓰지 않는다).
// 윈도우는 change 파일이 생기면 잠금을 쥔 채 금고 항목을 지우고 'changed'를 알린다.
const HOLD_MAC = `open(my $f, '>>', $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "locked\\n";
select(undef, undef, undef, 0.1) until -e $ENV{SMOKE_RELEASE};`
const HOLD_WINDOWS = `Add-Type -Namespace Smoke -Name Vault -MemberDefinition '[DllImport("advapi32.dll", CharSet = CharSet.Unicode)] public static extern bool CredDeleteW(string target, int type, int flags);'
$lock = New-Object System.Threading.Mutex($false, 'Local\\learnus-mcp.chatgpt')
[void]$lock.WaitOne()
[Console]::Out.WriteLine('locked')
$changed = $false
while (-not (Test-Path -LiteralPath $env:SMOKE_RELEASE)) {
  if (-not $changed -and (Test-Path -LiteralPath $env:SMOKE_CHANGE)) {
    if (-not [Smoke.Vault]::CredDeleteW('learnus-mcp.chatgpt', 1, 0)) { exit 1 }
    $changed = $true
    [Console]::Out.WriteLine('changed')
  }
  Start-Sleep -Milliseconds 100
}
$lock.ReleaseMutex()`

type Called = { status: number | null; stdout: string }

/** 헬퍼 대역을 백그라운드로 부르고, 대역이 헬퍼를 부르기 직전에 남긴 신호부터 1초가 지나도 안 끝났는지(잠금을 기다리는지) 본다. */
async function waiting(harness: string, mode: string, operation: string, input = '') {
  const started = join(harness, `${operation}.started`)
  let finished = false
  const done = promisify(execFile)(process.execPath, [join(harness, 'index.cjs'), mode], {
    env: {
      ...process.env,
      HELPER_OPERATION: operation,
      HELPER_INPUT: input,
      HELPER_STARTED: started,
    },
  }).then(({ stdout }) => JSON.parse(stdout) as Called)
  done.then(
    () => (finished = true),
    () => (finished = true),
  )
  await until(() => existsSync(started), `헬퍼 ${operation}: 대역이 헬퍼를 띄우지 못했습니다`)
  // 잠금이 없으면 헬퍼는 몇 ms 안에 끝난다
  await sleep(1000)
  assert.ok(!finished, `헬퍼 ${operation}: 잠금을 기다리지 않았습니다`)
  return { done }
}

/**
 * 다른 프로세스가 금고 잠금을 쥔 동안 저장·지우기·실패 표시(reject)가 모두 기다리는지,
 * 기다린 reject가 금고를 다시 읽는지 본다. 그사이 윈도우는 잠금을 쥔 쪽이 항목을 지우고
 * (→ missing, 지운 값을 되살리지 않음), 맥은 잠금 파일을 지워 다음 헬퍼가 새 파일로 잠그게 한 뒤
 * 다른 값을 저장한다(→ stale, 새 값 유지).
 */
async function lockCheck(
  vault: Vault,
  harness: string,
  fake: { username: string; password: string },
) {
  const signals = mkdtempSync(join(tmpdir(), 'learnus-lock-'))
  const lockFile = win
    ? ''
    : join(
        execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim(),
        'learnus-mcp.chatgpt.lock',
      )
  const holders: ChildProcess[] = []
  async function hold(round: string) {
    const env = {
      ...process.env,
      SMOKE_CHANGE: join(signals, `${round}-change`),
      SMOKE_RELEASE: join(signals, `${round}-release`),
    }
    const holder = win
      ? spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(HOLD_WINDOWS, 'utf16le').toString('base64'),
          ],
          { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
        )
      : spawn('perl', ['-MFcntl=:flock', '-e', HOLD_MAC, lockFile], {
          env,
          stdio: ['ignore', 'pipe', 'inherit'],
        })
    holders.push(holder)
    let said = ''
    holder.stdout.setEncoding('utf8').on('data', (chunk: string) => (said += chunk))
    await until(() => said.includes('locked'), '시험용 프로세스가 금고 잠금을 쥐지 못했습니다')
    return {
      async change() {
        writeFileSync(env.SMOKE_CHANGE, '')
        await until(() => said.includes('changed'), '잠금을 쥔 쪽이 금고 항목을 지우지 못했습니다')
      },
      release: () => writeFileSync(env.SMOKE_RELEASE, ''),
    }
  }
  try {
    // 1) 기다린 reject는 잠금을 잡은 뒤 금고를 다시 읽는다
    const first = await hold('reject')
    const reject = await waiting(
      harness,
      'chatgpt',
      'reject',
      JSON.stringify({ ...fake, code: 'WRONG_PASSWORD' }),
    )
    const other = { ...fake, password: `${fake.password} 새 값` }
    if (win) await first.change()
    else {
      rmSync(lockFile)
      assert.equal(vault('credentials-set', 'write', JSON.stringify(other)).status, 'ok')
    }
    first.release()
    const result = await reject.done
    assert.equal(result.status, 0, '기다린 실패 표시가 실패했습니다')
    assert.equal(JSON.parse(result.stdout).status, win ? 'missing' : 'stale')
    const now = vault('chatgpt', 'read')
    if (win) assert.equal(now.status, 'missing', '지운 금고 항목이 되살아났습니다')
    else
      assert.ok(
        now.credentials?.password === other.password && !now.credentials?.rejected,
        '새로 저장한 값을 옛 값으로 덮었습니다',
      )
    // 2) 저장·지우기도 같은 잠금을 기다린다 (풀린 뒤 순서는 정하지 않는다 → 끝나는지만 본다)
    const second = await hold('write-delete')
    const writing = await waiting(harness, 'credentials-set', 'write', JSON.stringify(fake))
    const deleting = await waiting(harness, 'credentials-clear', 'delete')
    second.release()
    for (const r of await Promise.all([writing.done, deleting.done]))
      assert.equal(r.status, 0, '기다린 저장·지우기가 실패했습니다')
  } finally {
    for (const holder of holders) holder.kill()
    rmSync(signals, { recursive: true, force: true })
  }
  console.log(
    `✔ OS 금고 잠금: 저장·지우기·실패 표시가 기다리고, 기다린 실패 표시는 그사이 ${win ? '지운 항목을 되살리지' : '새로 저장한 값을 덮지'} 않음`,
  )
}

/** OS 금고에 가짜 값 쓰기 → 실패 표시 → 새 서버가 보내지 않음 → 다시 저장하면 지워짐 → 잠금 → 지우기. */
async function vaultRoundTrip(vault: Vault, command: string, args: string[], harness: string) {
  // 한글·공백·기호를 섞어 UTF-8 왕복도 본다 (실제 비밀번호의 한글은 로그인 전에 거절된다)
  const fake = { username: 'smoke-user', password: `smoke ${process.pid} 값€!` }
  const save = () => vault('credentials-set', 'write', JSON.stringify(fake)).status
  const mark = (password: string) =>
    vault('chatgpt', 'reject', JSON.stringify({ ...fake, password, code: 'WRONG_PASSWORD' }))
  try {
    assert.equal(save(), 'ok')
    const back = vault('chatgpt', 'read').credentials
    assert.ok(
      back?.username === fake.username && back?.password === fake.password && !back?.rejected,
      '금고에서 읽은 값이 쓴 값과 다릅니다',
    )
    // 그사이 다른 값이 저장됐으면 표시하지 않고, 같은 값이면 실패 표시를 남긴다
    assert.equal(mark('other').status, 'stale')
    assert.equal(mark(fake.password).status, 'ok')
    assert.equal(vault('chatgpt', 'read').credentials?.rejected, 'WRONG_PASSWORD')
    // 새 대화(새 서버 프로세스)도 실패한 비밀번호를 보내지 않는다
    await session(
      'ChatGPT 실패 표시',
      command,
      args,
      '새 대화에서도 같은 비밀번호를 보내지 않습니다',
    )
    // 다시 저장하면 실패 표시가 지워진다
    assert.equal(save(), 'ok')
    assert.equal(vault('chatgpt', 'read').credentials?.rejected, undefined)
    await lockCheck(vault, harness, fake)
  } finally {
    vault('credentials-clear', 'delete')
  }
  assert.equal(vault('chatgpt', 'read').status, 'missing', '지운 뒤에도 금고 항목이 남아 있습니다')
  console.log('✔ OS 금고: 가짜 값 쓰기·실패 표시·다시 저장·지우기')
}

const root = mkdtempSync(join(tmpdir(), 'learnus 스모크 '))
try {
  // Claude: .mcpb를 확장 폴더처럼 풀고 manifest의 실행 설정 그대로 띄운다
  const claude = join(root, 'Claude Extensions', 'learnus')
  unpack(resolve('dist/learnus.mcpb'), claude)
  const { mcp_config: mcp } = JSON.parse(readFileSync(join(claude, 'manifest.json'), 'utf8')).server
  assert.equal(mcp.command, 'node')
  const args = (mcp.args as string[]).map((a) => a.replace('${__dirname}', claude))
  await session('Claude .mcpb', process.execPath, args, '아이디·비밀번호가 없습니다')

  if (!linux) {
    const name = win ? 'learnus-chatgpt-windows.zip' : 'learnus-chatgpt-macos.tar.gz'
    const gpt = join(root, 'LearnUs MCP')
    unpack(resolve('dist', name), gpt)
    const entry = join(gpt, 'index.cjs')
    // 사람이 직접 입력해야 하는 명령은 파이프로 부르면 거절한다
    const set = spawnSync(process.execPath, [entry, 'credentials-set'], {
      encoding: 'utf8',
      input: '',
    })
    assert.ok(set.status === 1 && set.stderr.includes('터미널에서 직접'), 'credentials-set 거절')
    // 셸에서 헬퍼를 바로 부르면 금고를 열기 전에 거절한다 (AI가 비밀번호를 보지 못하게)
    const helper = join(gpt, 'native', `learnus-credentials${win ? '.exe' : ''}`)
    const direct = spawnSync(helper, ['read'], { input: '', encoding: 'utf8', timeout: 10_000 })
    assert.ok(direct.status === 1 && direct.stdout === '{"status":"error"}', '헬퍼 직접 실행 거절')
    // 서버처럼 불러도 모드가 맞지 않으면 거절한다 (읽기는 chatgpt, 저장은 credentials-set, 삭제는 credentials-clear)
    const harness = join(root, 'harness')
    const call = helperHarness(helper, harness)
    for (const [mode, operation, input] of [
      ['chatgpt', 'write', '{"username":"a","password":"b"}'],
      ['credentials-set', 'read', ''],
      ['chatgpt', 'delete', ''],
    ]) {
      const r = call(mode, operation, input)
      assert.ok(r.status === 1 && r.stdout === '{"status":"error"}', `${mode} ${operation} 거절`)
    }
    // 금고에 항목이 있으면 서버가 로그인하려 한다 → 비어 있을 때만 계속
    const vault = vaultOf(call)
    assert.equal(vault('chatgpt', 'read').status, 'missing', '금고에 항목이 있어 멈춥니다')
    // chatgpt-config가 내놓은 command·args 그대로 띄운다 (경로 이스케이프까지 확인)
    const config = execFileSync(process.execPath, [entry, 'chatgpt-config'], { encoding: 'utf8' })
    const value = (key: string) => JSON.parse(new RegExp(`^${key} = (.+)$`, 'm').exec(config)![1])
    await session(`ChatGPT ${name}`, value('command'), value('args'), '아이디·비밀번호가 없습니다')
    // 서버 확인이 끝난 뒤에만 쓴다
    await vaultRoundTrip(vault, value('command'), value('args'), harness)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
