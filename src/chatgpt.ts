import { login, LoginError, type LoginErrorCode } from './auth.ts'
import { Client } from './client.ts'
import { readCredentials, rejectCredentials } from './credentials.ts'
import { createServer } from './server.ts'

// 금고의 실패 표시로 올 수 있는 값: 비밀번호를 보냈는데 포털이 받아들이지 않은(또는 결과를 모르는) 실패
const REJECTED = new Set<string>([
  'WRONG_PASSWORD',
  'PASSWORD_EXPIRED',
  'CAPTCHA',
  'LAYOUT_CHANGED',
  'UNKNOWN_RESULT',
])

export function createChatGPTServer() {
  const client = new Client(async () => {
    const credentials = await readCredentials()
    // login(undefined)은 Claude 환경변수 기본값으로 넘어가므로 명시적으로 중단한다.
    if (!credentials) throw new LoginError('NO_CREDENTIALS', undefined, 'chatgpt')
    // ChatGPT는 대화마다 서버가 따로 떠서 메모리 기억만으로는 새 대화가 같은 비밀번호를 또 보낸다 (원칙 6).
    // 다른 대화에서 실패한 조합이면 보내지 않는다. 사용자가 다시 저장하면 표시가 지워진다.
    if (credentials.rejected) {
      const code = REJECTED.has(credentials.rejected) ? credentials.rejected : 'UNKNOWN_RESULT'
      throw new LoginError(code as LoginErrorCode, undefined, 'chatgpt')
    }
    try {
      return await login(credentials)
    } catch (error) {
      if (!(error instanceof LoginError)) throw error
      const localized = new LoginError(error.code, error.portalMessage, 'chatgpt')
      localized.trace = error.trace
      // 이번에 비밀번호를 보내 실패했을 때만 표시한다. 같은 대화의 메모리 재생까지 표시하면,
      // 사용자가 다시 저장해 지운 표시를 옛 대화가 되살린다.
      if (error.lockoutRisk) {
        const marked = await rejectCredentials(credentials, error.code).then(
          () => true,
          () => false,
        )
        if (!marked)
          localized.message +=
            ' (금고에 실패 표시를 남기지 못해 새 대화에서는 한 번 더 보낼 수 있습니다. 확인을 마칠 때까지 LearnUs를 묻지 마세요.)'
      }
      throw localized
    }
  })
  return createServer(client, 'chatgpt')
}

/** 비밀값 없는 설정 예시만 생성한다. 기존 앱 설정 파일은 읽거나 고치지 않는다. */
export function chatgptConfig(executable: string, entry: string) {
  return `[mcp_servers.learnus]\ncommand = ${JSON.stringify(executable)}\nargs = [${JSON.stringify(entry)}, "chatgpt"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 180\n`
}
