import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { LearnUsError } from './client.ts'

export type Credentials = { username: string; password: string }
/** rejected: 다른 대화(서버 프로세스)에서 이 조합으로 로그인이 실패했다는 표시. 다시 저장하면 지워진다. */
export type StoredCredentials = Credentials & { rejected?: string }
const FAILURE =
  "OS 금고에 접근하지 못했습니다. 금고 잠금·접근 권한과 ChatGPT용 설치 파일을 확인해 주세요. (맥에서 브라우저로 받아 Finder로 풀었다면 설치 안내의 다운로드 표시 지우기를 따라 주세요. 맥에서 키체인 확인 창이 떴다면 '항상 허용'을 누른 뒤 다시 요청해 주세요.)"

function valid(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== 'object') return false
  const c = value as StoredCredentials
  return (
    typeof c.username === 'string' &&
    !!c.username.trim() &&
    typeof c.password === 'string' &&
    !!c.password &&
    (c.rejected === undefined ||
      (typeof c.rejected === 'string' && /^[A-Z_]{1,32}$/.test(c.rejected))) &&
    Buffer.byteLength(JSON.stringify({ username: c.username, password: c.password })) <= 2560
  )
}

/** 전용 헬퍼만 실행한다. 금고 데이터는 부모/자식 파이프 밖에 출력하지 않는다. */
async function invoke(
  operation: 'read' | 'write' | 'delete' | 'reject',
  value?: Credentials & { code?: string },
) {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new LearnUsError('ChatGPT OS 금고 연결은 macOS·Windows에서만 지원합니다.')
  }
  const here = import.meta.dirname
  const root = import.meta.filename.endsWith('.ts') ? join(here, '..', 'dist') : here
  const executable = join(
    root,
    'native',
    `learnus-credentials${process.platform === 'win32' ? '.exe' : ''}`,
  )
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, [operation], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        // 다른 앱의 인증 환경변수와 런타임 주입 옵션을 물려주지 않는다.
        env: Object.fromEntries(
          ['HOME', 'TMPDIR', 'SystemRoot', 'WINDIR', 'USERPROFILE'].flatMap((key) =>
            process.env[key] ? [[key, process.env[key]!]] : [],
          ),
        ),
      })
      let output = ''
      let size = 0
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (ok) resolve(output)
        else {
          child.kill()
          reject(new Error())
        }
      }
      const timer = setTimeout(() => finish(false), 30_000)
      child.on('error', () => finish(false))
      child.stdin.on('error', () => finish(false))
      child.stdout.on('error', () => finish(false))
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk)
        if (size > 8192) finish(false)
        else output += chunk
      })
      child.on('close', (code) => finish(code === 0))
      child.stdin.end(value ? JSON.stringify(value) : '')
    })
    const result: unknown = JSON.parse(output)
    if (!result || typeof result !== 'object') throw new Error()
    const r = result as { status?: string; credentials?: unknown }
    if (r.status === 'missing' && operation !== 'write') return undefined
    // reject: 그사이 사용자가 새 값을 저장했으면 헬퍼가 표시하지 않고 stale을 돌려준다
    if (r.status === 'stale' && operation === 'reject') return undefined
    if (r.status !== 'ok') throw new Error()
    if (operation === 'read') {
      if (!valid(r.credentials)) throw new Error()
      const { username, password, rejected } = r.credentials
      return rejected ? { username, password, rejected } : { username, password }
    }
    return undefined
  } catch {
    throw new LearnUsError(FAILURE)
  }
}

export const readCredentials = () => invoke('read')
export async function writeCredentials(value: Credentials): Promise<void> {
  if (!valid(value))
    throw new LearnUsError('아이디·비밀번호가 비어 있거나 너무 깁니다. 다시 입력해 주세요.')
  await invoke('write', { username: value.username, password: value.password })
}
export async function deleteCredentials(): Promise<void> {
  await invoke('delete')
}
/** 로그인이 실패한 조합이 아직 금고에 있으면 실패 표시를 남긴다 (새 대화에서도 다시 보내지 않게). */
export async function rejectCredentials(value: Credentials, code: string): Promise<void> {
  await invoke('reject', { username: value.username, password: value.password, code })
}
