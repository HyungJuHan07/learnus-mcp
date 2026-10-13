import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CookieJar } from 'tough-cookie'
import { login, LoginError } from './auth.ts'
import { Client, LearnUsError, userMessage } from './client.ts'
import { createChatGPTServer, chatgptConfig } from './chatgpt.ts'
import { stableNodePath } from './node-path.ts'
import { writeCredentials, deleteCredentials } from './credentials.ts'
import { VERSION } from './config.ts'
import {
  getAnnouncement,
  getAssignment,
  listAnnouncements,
  listCourses,
  unwatchedVideos,
  upcomingDeadlines,
} from './learnus.ts'
import { listMaterials } from './materials.ts'

const HELP = `learnus-mcp ${VERSION} — 비공식(Unofficial) LearnUs 읽기 전용 MCP 서버. 연세대학교와 무관한 학생 프로젝트입니다.

  learnus-mcp          AI 앱이 실행하는 MCP 서버 (직접 실행할 필요 없음)
  learnus-mcp check    내 아이디·비밀번호로 로그인하고 조회 기능을 한 번씩 시험 (저장·다운로드 없음, 공지 본문 하나·과제 하나를 열어 조회수·열람 표시가 남을 수 있음)
  learnus-mcp chatgpt             ChatGPT용 OS 금고 인증 MCP 서버
  learnus-mcp credentials-set     사람이 직접 로그인 정보를 OS 금고에 저장 (학교 접속 없음)
  learnus-mcp credentials-clear   사람이 확인한 뒤 ChatGPT용 금고 항목 삭제
  learnus-mcp chatgpt-config      비밀값 없는 ChatGPT MCP 설정 예시 출력`

// eslint-disable-next-line no-control-regex -- 터미널 제어 문자(C0·DEL·C1)를 찾는다
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
/** LearnUs·포털에서 온 글의 제어 문자를 \xNN 글자로 바꿔 터미널이 명령으로 읽지 못하게 한다 (줄 지우기·가짜 줄 막기). */
export const term = (s: string) =>
  s.replace(CONTROL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)

export async function runCli(command: string) {
  if (command === 'chatgpt') return createChatGPTServer().connect(new StdioServerTransport())
  if (command === 'chatgpt-config')
    return console.log(chatgptConfig(stableNodePath(), resolve(process.argv[1])))
  if (command === 'credentials-set' || command === 'credentials-clear')
    return manageCredentials(command)
  if (command === 'check') return check()
  if (command === '--version' || command === 'version') return console.log(VERSION)
  console.log(HELP)
  if (command !== 'help' && command !== '--help') process.exitCode = 1
}

/** 터미널 입력. hidden이면 입력한 글자를 화면에 찍지 않는다. */
async function ask(question: string, hidden = false): Promise<string> {
  // node:readline/promises는 _writeToOutput을 쓰지 않아 입력이 그대로 보인다 → 예전 readline을 쓴다.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (hidden) (rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {}
  process.stdout.write(question)
  return new Promise<string>((done, reject) => {
    let answered = false
    rl.once('SIGINT', () => rl.close())
    rl.once('close', () => {
      if (hidden) process.stdout.write('\n')
      if (!answered) reject(new LearnUsError('입력이 취소되었습니다.'))
    })
    rl.question('', (value) => {
      answered = true
      rl.close()
      done(value)
    })
  })
}

async function manageCredentials(command: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      '금고 설정은 사람이 터미널에서 직접 실행해야 합니다. 로그인 정보를 AI·스크립트로 넘기지 마세요.',
    )
    process.exitCode = 1
    return
  }
  try {
    if (command === 'credentials-clear') {
      if (
        (await ask('ChatGPT용 LearnUs 로그인 정보를 지울까요? 삭제하려면 yes: ')).trim() !== 'yes'
      )
        return
      await deleteCredentials()
      console.log(
        'ChatGPT용 금고 항목을 삭제했습니다. 실행 중인 LearnUs MCP 서버도 다시 시작해 주세요.',
      )
    } else {
      // 아이디는 보이게 받는다: 학번 오타가 다른 학생 계정의 로그인 실패로 쌓이지 않게
      const username = (await ask('연세포털 아이디(학번): ')).trim()
      const password = await ask('비밀번호 (표시되지 않음): ', true)
      if (password !== (await ask('비밀번호 다시 입력 (표시되지 않음): ', true))) {
        throw new LearnUsError('두 비밀번호가 다릅니다. 저장하지 않았습니다.')
      }
      await writeCredentials({ username, password })
      console.log(
        'OS 금고에 저장했습니다. 학교에는 접속하지 않았습니다. ChatGPT MCP 서버를 다시 시작해 주세요.',
      )
    }
  } catch (error) {
    console.error(userMessage(error, '금고 설정을 완료하지 못했습니다.'))
    process.exitCode = 1
  }
}

async function check() {
  if (!process.stdin.isTTY) {
    console.error(
      'check는 사람이 터미널에서 직접 실행해야 합니다 (비밀번호를 AI·스크립트로 넘기지 마세요).',
    )
    process.exitCode = 1
    return
  }
  const username = (await ask('연세포털 아이디(학번): ')).trim()
  const password = await ask('비밀번호 (화면에 표시되지 않음): ', true)
  console.log('로그인 중입니다 (몇 초 걸립니다)...')
  let jar: CookieJar | undefined
  try {
    jar = await login({ username, password })
  } catch (e) {
    console.error(term(userMessage(e, '알 수 없는 오류로 로그인에 실패했습니다.')))
    // 위 문구는 Claude용이다. check는 실행할 때마다 새로 로그인하므로 다시 실행하면 비밀번호가 한 번 더 간다.
    if (e instanceof LoginError && e.code !== 'NO_CREDENTIALS' && e.code !== 'KOREAN_INPUT') {
      console.error(
        '\n[check] 다시 실행하면 비밀번호가 한 번 더 전송됩니다. 브라우저로 연세포털 로그인을 먼저 확인한 뒤에만 다시 실행하세요.',
      )
    }
    // 문제 신고용: 거쳐 간 단계 (경로·폼 칸 이름만, 값 없음)
    if (e instanceof LoginError && e.trace.length)
      console.error(`\n거쳐 간 단계:\n- ${e.trace.map(term).join('\n- ')}`)
    process.exitCode = 1
    return
  }
  console.log('로그인 성공. 조회 기능을 하나씩 시험합니다 (과목 수만큼 페이지를 읽습니다)...\n')
  // 처음엔 방금 로그인한 세션, 그 뒤 만료되면 같은 아이디·비밀번호로 다시 로그인
  const session = new Client(async () => {
    const first = jar
    jar = undefined
    return first ?? login({ username, password })
  })
  // 기능마다 도구 호출 하나처럼 새 클라이언트 (같은 세션, 재로그인은 기능마다 최대 1번)
  const c = () => session.withSignal()
  const courses = await step('강좌 목록', () => listCourses(c()))
  const deadlines = await step('마감 일정 (14일)', () => upcomingDeadlines(c(), 14))
  const notices = await step('전 과목 공지', () => listAnnouncements(c(), undefined, 5))
  if (notices?.[0]) {
    const n = notices[0]
    await step('공지 본문', () => getAnnouncement(c(), n.board_id, n.post_id))
  }
  const assignment = deadlines?.find((d) => d.assignment_id)?.assignment_id
  if (assignment) await step('과제 상세', () => getAssignment(c(), assignment))
  if (courses?.[0]) {
    await step(`과목 공지 (${courses[0].name})`, () => listAnnouncements(c(), courses[0].id, 3))
    await step(`강의자료 목록 (${courses[0].name})`, () => listMaterials(c(), courses[0].id))
  }
  await step('안 본 동영상 (전 과목)', () => unwatchedVideos(c()))
}

/** 기능 하나를 돌려 개수와 첫 항목을 보여 준다 (이 터미널에만). */
async function step<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await run()
    const list = Array.isArray(result) ? result : [result]
    const first = JSON.stringify(list[0] ?? null)
    console.log(
      term(`✔ ${label}: ${list.length}개${list.length ? ` — 첫 항목 ${first.slice(0, 300)}` : ''}`),
    )
    return result
  } catch (e) {
    console.log(term(`✘ ${label}: ${userMessage(e, '알 수 없는 오류')}`))
    return undefined
  }
}
