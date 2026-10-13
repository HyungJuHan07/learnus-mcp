import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { stableNodePath } from '../src/node-path.ts'

const FAILURE = 'ChatGPT 설정을 확인하지 못했습니다. 데스크톱 앱과 Codex CLI 설치를 확인해 주세요.'
type Options = {
  source: string
  destination: string
  codex: string
  node: string
  configFile: string
}

function plainTree(path: string) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
    throw new Error('설치 파일에 심볼릭 링크 또는 지원하지 않는 항목이 있습니다.')
  if (stat.isDirectory()) for (const name of readdirSync(path)) plainTree(join(path, name))
}

/** 검증한 배포물만 전달한다. 비밀값·금고·학교에는 접근하지 않는다. */
export function install(options: Options) {
  const { source, destination, codex, node, configFile } = options
  const helper = process.platform === 'win32' ? 'learnus-credentials.exe' : 'learnus-credentials'
  plainTree(join(source, 'native', helper))
  const files = [
    'index.cjs',
    'native',
    'cmaps',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'INSTALL_CHATGPT.md',
  ]
  for (const file of files) plainTree(join(source, file))
  const command = (args: string[]) =>
    execFileSync(
      codex.endsWith('.js') ? node : codex,
      codex.endsWith('.js') ? [codex, ...args] : args,
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        // 저장소별 설정이 아닌 사용자 설정을 다루도록 패키지 폴더에서 실행한다.
        cwd: source,
      },
    )
  let registered = false
  try {
    command(['mcp', 'get', 'learnus', '--json'])
    registered = true
  } catch (error) {
    const result = error as { status?: number; stderr?: string }
    if (result.status !== 1 || !result.stderr?.includes("No MCP server named 'learnus' found."))
      // 원본 CLI 오류에는 사용자 설정 값이 포함될 수 있어 cause도 보존하지 않는다.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(FAILURE)
  }
  if (registered)
    throw new Error(
      'learnus가 이미 등록되어 있습니다. 기존 설정을 유지했습니다. 도움말로 연결을 확인하세요.',
    )
  // 공식 CLI가 설정 파일을 다시 쓰며 주석·줄 배치가 바뀔 수 있어, 바꾸기 전에 원본을 같은 폴더에 남긴다 (본인만 읽기)
  let backup: string | undefined
  if (existsSync(configFile)) {
    backup = `${configFile}.learnus-backup-${Date.now()}`
    copyFileSync(configFile, backup, constants.COPYFILE_EXCL)
    chmodSync(backup, 0o600)
  }
  // 재실행·업데이트도 기존 설치본을 덮어쓰지 않는다.
  mkdirSync(destination)
  for (const file of files)
    cpSync(join(source, file), join(destination, file), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
  try {
    command(['mcp', 'add', 'learnus', '--', node, join(destination, 'index.cjs'), 'chatgpt'])
    if (!lstatSync(configFile).isFile() || lstatSync(configFile).isSymbolicLink()) throw new Error()
    const original = readFileSync(configFile, 'utf8')
    const updated = withTimeouts(original)
    const temporary = configFile + '.learnus-' + process.pid + '.tmp'
    let created = false
    try {
      writeFileSync(temporary, updated, { flag: 'wx', mode: 0o600 })
      created = true
      if (readFileSync(configFile, 'utf8') !== original) throw new Error()
      renameSync(temporary, configFile)
    } finally {
      if (created) rmSync(temporary, { force: true })
    }
    const saved = JSON.parse(command(['mcp', 'get', 'learnus', '--json'])) as {
      tool_timeout_sec?: number
    }
    if (saved.tool_timeout_sec !== 180) throw new Error()
  } catch {
    throw new Error(
      `MCP를 등록하지 못했거나 제한 시간을 확인하지 못했습니다. 설치 파일과 현재 설정은 남겼습니다.${backup ? ` 바꾸기 전 Codex 설정 백업: ${backup}.` : ''} 설치 안내의 수동 등록 절차를 확인하세요.`,
    )
  }
  return { destination, backup }
}

/** 등록한 node로 서버가 뜨므로 지원하지 않는 버전은 등록하지 않는다 (package.json engines와 같다). */
export function supportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 18)
}

/** CLI가 새로 만든 섹션만 수정한다. 애매한 텍스트는 추측하지 않는다. */
export function withTimeouts(text: string) {
  const header = /^\[mcp_servers\.learnus\]\r?$/gm
  if ([...text.matchAll(header)].length !== 1)
    throw new Error('MCP를 등록하지 못했습니다. 제한 시간을 수동 설정하세요.')
  return text.replace(
    header,
    '[mcp_servers.learnus]\nstartup_timeout_sec = 30\ntool_timeout_sec = 180',
  )
}

export function findCodex(node: string) {
  if (process.env.LEARNUS_CODEX_CLI) return process.env.LEARNUS_CODEX_CLI
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']
      : [
          join(
            process.env.APPDATA || homedir(),
            'npm',
            'node_modules',
            '@openai',
            'codex',
            'bin',
            'codex.js',
          ),
          join(dirname(node), 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
        ]
  return (
    candidates.find((path) => existsSync(path)) ||
    (process.platform === 'win32' ? 'codex.exe' : 'codex')
  )
}

function main() {
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    throw new Error('macOS·Windows에서 실행하세요.')
  if (!supportedNode())
    throw new Error(
      'Node.js 22.18 이상이 필요합니다. nodejs.org의 LTS를 설치한 뒤 그 node로 다시 실행해 주세요.',
    )
  const source = import.meta.dirname
  const codex = findCodex(process.execPath)
  const destination = resolve(homedir(), `LearnUs-MCP-${Date.now()}`)
  const { destination: installed, backup } = install({
    source,
    destination,
    codex,
    // Homebrew의 버전별 경로 대신 /opt/homebrew/bin/node처럼 업그레이드해도 남는 경로
    node: stableNodePath(process.execPath),
    configFile: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'),
  })
  console.log('LearnUs 설치·MCP 등록 완료. 학교에는 접속하지 않았습니다.')
  console.log(`설치 폴더: ${installed}`)
  if (backup) console.log(`바꾸기 전 Codex 설정 백업: ${backup}`)
  if (process.platform === 'darwin') {
    console.log(
      '로그인 정보 입력창을 열려면 GPT에게 “LearnUs 로그인 설정 창 열어줘”라고 요청하세요.',
    )
    console.log(`입력창 프로그램: ${join(installed, 'native', 'learnus-credentials')} setup`)
  } else {
    console.log(
      '이제 사용자가 설치 폴더의 터미널에서 node index.cjs credentials-set을 직접 실행하세요.',
    )
  }
  console.log('등록 후 앱에서 MCP를 재시작하고 새 대화에서 LearnUs 도움말을 요청하세요.')
}
if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    // OS·CLI 오류는 출력하지 않는다. 위에서 작성한 안내만 허용한다.
    const known =
      error instanceof Error &&
      /^(ChatGPT 설정|설치 파일에|learnus가 이미|MCP를 등록|macOS·Windows|Node\.js)/.test(
        error.message,
      )
    console.error(
      known ? error.message : '설치를 완료하지 못했습니다. 배포물·폴더 권한을 확인해 주세요.',
    )
    process.exitCode = 1
  }
}
