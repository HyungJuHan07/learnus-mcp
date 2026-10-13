import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto'
import * as cheerio from 'cheerio/slim'
import { CookieJar } from 'tough-cookie'
import { assertNotBlocked, LearnUsError, looksLoggedOut, request, type Page } from './client.ts'
import { BASE_URL, env, PORTAL_URL, REPO_URL, type Host } from './config.ts'

type Credentials = { username: string; password: string }

export type LoginErrorCode =
  | 'NO_CREDENTIALS'
  | 'KOREAN_INPUT'
  | 'WRONG_PASSWORD'
  | 'PASSWORD_EXPIRED'
  | 'CAPTCHA'
  | 'LAYOUT_CHANGED'
  | 'UNKNOWN_RESULT'
  | 'NEEDS_BROWSER'

function loginMessage(code: LoginErrorCode, host: Host) {
  const gpt = host === 'chatgpt'
  const SETTINGS = gpt
    ? 'LearnUs 로그인 정보 등록(맥: GPT에게 "LearnUs 로그인 설정 창 열어줘", 윈도우: 설치 폴더에서 node index.cjs credentials-set)'
    : 'Claude 데스크톱 설정 → 확장 프로그램 → LearnUs'
  const APP = gpt ? 'ChatGPT' : 'Claude'
  // ChatGPT는 대화마다 서버가 따로 떠서, 실패 표시를 금고 항목에 남기고 다시 저장할 때까지 보내지 않는다 (chatgpt.ts)
  const RETRY = gpt
    ? '계정 잠김을 막기 위해 로그인 정보를 다시 저장하기 전까지는 새 대화에서도 같은 비밀번호를 보내지 않습니다.'
    : `계정 잠김을 막기 위해 ${APP}를 켜 둔 동안에는 같은 비밀번호를 다시 보내지 않지만, ${APP}를 다시 켜면 한 번 더 시도합니다.`
  const RESAVE = `${SETTINGS}에서 로그인 정보를 다시 저장한 뒤(같은 값이어도 됩니다) 새 대화에서 요청해 주세요.`

  const MESSAGES: Record<LoginErrorCode, string> = {
    NO_CREDENTIALS: `LearnUs 아이디·비밀번호가 없습니다. ${SETTINGS}에서 입력해 주세요.`,
    KOREAN_INPUT: `비밀번호에 한글이나 전각 글자가 섞여 있어 포털에 보내지 않았습니다. 한/영 키로 영문 입력으로 바꾼 뒤 ${SETTINGS}에서 비밀번호를 다시 입력해 주세요.`,
    WRONG_PASSWORD: `연세포털 로그인에 실패했습니다. ${RETRY} 먼저 브라우저로 연세포털에 로그인되는지 확인한 뒤 ${SETTINGS}에서 아이디·비밀번호를 고쳐 주세요. (AI에게: 이 대화에서 LearnUs 도구를 다시 부르지 마세요.)`,
    PASSWORD_EXPIRED: `연세포털이 비밀번호 변경을 요구합니다. 포털에서 비밀번호를 바꾼 뒤 ${SETTINGS}에 새 비밀번호를 넣어 주세요.`,
    CAPTCHA: `연세포털이 보안문자를 요구합니다 (비밀번호 오류가 여러 번 쌓였을 때). 브라우저로 연세포털에 직접 로그인해 비밀번호를 확인하고, ${gpt ? RESAVE : `바뀌었다면 ${SETTINGS}에서 고친 뒤 ${APP}를 다시 켜 주세요.`}`,
    LAYOUT_CHANGED: `연세포털 로그인 화면이 예상과 달라 로그인하지 못했습니다. ${REPO_URL}/issues 에 알려 주세요.${gpt ? ' 비밀번호를 보낸 뒤 생긴 일이면 계정 잠김을 막기 위해 로그인 정보를 다시 저장하기 전까지는 새 대화에서도 다시 보내지 않습니다.' : ''}`,
    NEEDS_BROWSER: `로그인 중 LearnUs가 이 도구가 열지 않는 화면(동의·정보 입력 등)으로 보냈습니다. 브라우저로 LearnUs에 한 번 로그인해 그 화면을 확인한 뒤 ${gpt ? '새 대화에서 다시 요청해 주세요.' : `${APP}를 다시 켜 주세요.`}`,
    UNKNOWN_RESULT: gpt
      ? `연세포털이 로그인 결과를 알려 주지 않았습니다 (응답이 없거나 오류). ${RETRY} 브라우저로 연세포털에 로그인되는지 확인한 뒤 ${RESAVE}`
      : `연세포털이 로그인 결과를 알려 주지 않았습니다 (응답이 없거나 오류). 계정 잠김을 막기 위해 ${APP}를 다시 켤 때까지 다시 시도하지 않습니다. 브라우저로 연세포털에 로그인되는지 확인한 뒤 ${APP}를 다시 켜 주세요.`,
  }
  return MESSAGES[code]
}

/** 메시지는 위 고정 문구(와 포털이 보여 준 안내 문구)뿐이다. 입력값은 담지 않는다. */
export class LoginError extends LearnUsError {
  readonly code: LoginErrorCode
  readonly portalMessage?: string
  /** 거쳐 간 단계 (메서드·경로·폼 칸 이름만, 값 없음). `check` 명령만 보여 준다. */
  trace: string[] = []
  /** 이번 호출에서 비밀번호를 보냈는데 포털이 받아들이지 않은(또는 결과를 모르는) 실패 — 잠김 위험이 있다.
   *  ChatGPT는 이때만 금고 항목에 실패 표시를 남긴다 (같은 프로세스의 메모리 재생은 false). */
  lockoutRisk = false
  constructor(code: LoginErrorCode, portalMessage?: string, host: Host = 'claude') {
    const message = loginMessage(code, host)
    super(portalMessage ? `${message} (포털 안내: ${portalMessage})` : message)
    this.code = code
    this.portalMessage = portalMessage
  }
}

/** .mcpb 설치 화면에 입력한 값이 환경변수로 들어온다 (Claude 데스크톱이 OS 금고에 보관). */
function getCredentials(): Credentials | undefined {
  const username = env('LEARNUS_USERNAME')
  // 비밀번호는 앞뒤 공백도 그대로 쓴다 (env()는 공백을 잘라서 쓰지 않음).
  const password = process.env.LEARNUS_PASSWORD
  return username && password && !password.startsWith('${') ? { username, password } : undefined
}

// 원칙 1: 로그인 중 POST는 SSO 폼 제출 세 곳뿐.
const LOGIN_POSTS = new Set([
  `${PORTAL_URL}/sso/PmSSOService`,
  `${PORTAL_URL}/sso/PmSSOAuthService`,
  `${BASE_URL}/passni/sso/spLoginData.php`,
])

/** 로그인 중에만 쓰는 검사: LearnUs·연세포털로 가는 https GET과 위 세 곳의 폼 제출(POST)만. */
export function assertLoginRequest(method: string, url: URL) {
  if (url.origin === BASE_URL) {
    try {
      assertNotBlocked(url)
    } catch {
      throw new LoginError('NEEDS_BROWSER')
    }
  }
  if (
    url.protocol !== 'https:' ||
    (url.origin !== BASE_URL && url.origin !== PORTAL_URL) ||
    !(method === 'GET' || (method === 'POST' && LOGIN_POSTS.has(url.origin + url.pathname)))
  ) {
    throw new LoginError('LAYOUT_CHANGED')
  }
}

type Form = { action: string; method: 'GET' | 'POST'; fields: [string, string][] }

function formOf(page: Page, selector: string): Form | undefined {
  const $ = cheerio.load(page.text)
  const form = $(selector).first()
  if (!form.length) return undefined
  return {
    action: new URL(form.attr('action') ?? '', page.url).href,
    method: form.attr('method')?.toUpperCase() === 'POST' ? 'POST' : 'GET',
    fields: form
      .find('input[name]')
      .toArray()
      .map((el): [string, string] => [$(el).attr('name') ?? '', $(el).attr('value') ?? '']),
  }
}

/**
 * 포털 페이지의 fSubmitSSOLoginForm2와 똑같이 암호화한다 (포털 스크립트를 테스트 키로 돌려 대조함):
 * prototype.js 1.6.1 Object.toJSON 형식의 JSON → jsbn RSAKey.encrypt (PKCS#1 v1.5) → 16진수.
 */
function encryptLogin(
  { username, password }: Credentials,
  challenge: string,
  modulusHex: string,
): string {
  const json = `{"userid": ${JSON.stringify(username)}, "userpw": ${JSON.stringify(password)}, "ssoChallenge": ${JSON.stringify(challenge)}}`
  // jsbn pkcs1pad2는 UTF-16 코드 단위마다 UTF-8처럼 인코딩한다. 그대로 따른다.
  const bytes: number[] = []
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i)
    if (c < 128) bytes.push(c)
    else if (c < 2048) bytes.push((c >> 6) | 192, (c & 63) | 128)
    else bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128)
  }
  const n = Buffer.from(modulusHex.length % 2 ? `0${modulusHex}` : modulusHex, 'hex')
  const key = createPublicKey({
    key: { kty: 'RSA', n: n.toString('base64url'), e: 'AQAB' },
    format: 'jwk',
  })
  const cipher = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(bytes))
  return cipher.toString('hex')
}

type Step = { method: 'GET' | 'POST'; url: string; body?: string }

/** 폼 제출 = 다음 요청 하나. */
function stepOf(form: Form): Step {
  const body = new URLSearchParams(form.fields).toString()
  return form.method === 'POST'
    ? { method: 'POST', url: form.action, body }
    : { method: 'GET', url: `${form.action.split('?')[0]}?${body}` }
}

const loggedIn = (page: Page) => {
  const u = new URL(page.url)
  return u.origin === BASE_URL && !u.pathname.startsWith('/passni') && !looksLoggedOut(page)
}

const captchaOn = (form: Form) => form.fields.some(([k, v]) => k === 'captcha_yn' && v === 'Y')

/**
 * 브라우저 없이 연세포털 SSO로 로그인하고 LearnUs 쿠키가 든 쿠키 통을 돌려준다.
 * login.php → spLogin2.php(자동 제출 폼) → 포털 로그인 화면 → 암호화해 제출 → LearnUs로 돌아오는 자동 단계들.
 * trace에는 거쳐 간 단계(메서드·경로·폼 칸 이름만, 값 없음)를 남긴다.
 */
type Progress = { trace: string[]; sentPassword: boolean; portalAccepted: boolean }

async function httpLogin(creds: Credentials, progress: Progress): Promise<CookieJar> {
  const { trace } = progress
  const jar = new CookieJar()
  const go = async (step: Step, referer: string) => {
    const page = await request(jar, step.method, step.url, {
      guard: assertLoginRequest,
      body: step.body,
      form: true,
      referer,
    })
    const u = new URL(page.url)
    const $ = cheerio.load(page.text)
    const forms = $('form')
      .toArray()
      .map((f) => {
        const names = $(f)
          .find('input[name]')
          .toArray()
          .map((i) => $(i).attr('name'))
        return `${$(f).attr('id') ?? $(f).attr('name') ?? '?'}[${names.join(',')}]`
      })
    trace.push(`${step.method} ${u.origin}${u.pathname} → 폼 ${forms.join(' ') || '없음'}`)
    return page
  }

  const loginPage = await go({ method: 'GET', url: `${BASE_URL}/login.php` }, `${BASE_URL}/`)
  // 로그인 페이지에서 넘어온 것처럼 Referer가 있어야 한다 (없으면 "Incorrect access!!").
  const start = await go(
    { method: 'GET', url: `${BASE_URL}/passni/sso/spLogin2.php` },
    loginPage.url,
  )
  const sso = formOf(start, '#frmSSO')
  if (!sso) throw new LoginError('LAYOUT_CHANGED')
  const portal = await go(stepOf(sso), start.url)

  const form = formOf(portal, '#ssoLoginForm')
  const modulus = /setPublic\(\s*'([0-9a-fA-F]+)'\s*,\s*'10001'\s*\)/.exec(portal.text)?.[1]
  const challenge = /ssoChallenge\s*=\s*'([^']+)'/.exec(portal.text)?.[1]
  if (!form || !modulus || !challenge) throw new LoginError('LAYOUT_CHANGED')
  if (captchaOn(form)) throw new LoginError('CAPTCHA')

  // 브라우저와 같이: 아이디·비밀번호 칸은 비우고 암호문만 E2에 담는다.
  const E2 = encryptLogin(creds, challenge, modulus)
  form.fields = form.fields.map(([k, v]): [string, string] =>
    k === 'E2' ? [k, E2] : k === 'loginId' || k === 'loginPasswd' ? [k, ''] : [k, v],
  )
  progress.sentPassword = true
  const result = await go(stepOf(form), portal.url)

  // 성공이든 실패든 포털은 같은 이름의 폼(ssoLoginForm)을 돌려준다. 가는 곳만 다르다:
  // 성공 → LearnUs spLoginData.php (E3·E4·S2·CLTID), 실패 → 포털 로그인 화면 + 안내 문구(returnMessage).
  const back = formOf(result, '#ssoLoginForm')
  if (!back || new URL(back.action).origin !== BASE_URL) {
    const message = /var returnMessage\s*=\s*'([^']*)'/
      .exec(result.text)?.[1]
      ?.replace(/<br\s*\/?>/gi, ' ')
      .trim()
      .slice(0, 200)
    const retCode = /var retCode\s*=\s*'([^']*)'/.exec(result.text)?.[1]
    if (retCode === '[PM_UAN]038') throw new LoginError('PASSWORD_EXPIRED', message)
    if (back && captchaOn(back)) throw new LoginError('CAPTCHA', message)
    throw new LoginError(message ? 'WRONG_PASSWORD' : 'LAYOUT_CHANGED', message)
  }
  // 여기부터는 포털이 비밀번호를 받아들인 뒤의 LearnUs 단계다 (포털 오류 횟수와 무관).
  progress.portalAccepted = true

  // 브라우저가 자동으로 하는 나머지: spLoginData.php 제출 → spLoginProcess.php (여기서 LearnUs 세션이 생긴다)
  await go(stepOf(back), result.url)
  let page = await go({ method: 'GET', url: `${BASE_URL}/passni/spLoginProcess.php` }, back.action)
  // 대시보드로 바로 오지 않았으면(자바스크립트 이동 등) 대시보드로 한 번 확인한다.
  if (!loggedIn(page)) page = await go({ method: 'GET', url: `${BASE_URL}/` }, page.url)
  if (!loggedIn(page)) throw new LoginError('LAYOUT_CHANGED')
  return jar
}

// 이 프로세스에서 로그인에 실패한 아이디·비밀번호 조합과 그 이유 (해시, 메모리에만).
// 같은 조합으로는 포털에 다시 보내지 않는다 → 도구를 여러 번 불러도 실패 횟수가 쌓이지 않는다.
// ponytail: 프로세스마다 1번. 디스크에 남기면 비밀번호 파생값이 생겨 남기지 않는다.
let rejected: { key: string; code: LoginErrorCode; portalMessage?: string } | undefined

/** Client가 세션이 없거나 만료됐을 때 부른다. 실패하면 자동으로 다시 시도하지 않는다 (원칙 6). */
export async function login(creds = getCredentials()): Promise<CookieJar> {
  if (!creds) throw new LoginError('NO_CREDENTIALS')
  // 브라우저의 비밀번호 칸은 한글 입력을 막는다 → 한글·전각 글자(U+FF01–FF5E)가 있으면 한/영·전각 전환 실수.
  // 보내면 오류 횟수(5회 잠김)만 쌓인다.
  if (/[\p{Script=Hangul}\uFF01-\uFF5E]/u.test(creds.password)) throw new LoginError('KOREAN_INPUT')
  const key = createHash('sha256').update(`${creds.username}\n${creds.password}`).digest('hex')
  if (rejected?.key === key) throw new LoginError(rejected.code, rejected.portalMessage)
  const progress: Progress = { trace: [], sentPassword: false, portalAccepted: false }
  try {
    return await httpLogin(creds, progress)
  } catch (e) {
    // 우리 오류(고정 문구)만 내보낸다. 그 밖의 오류 원문은 주소·입력값이 섞일 수 있어 버린다.
    // 비밀번호를 보내기 전이거나, 포털이 받아들인 뒤 LearnUs 단계의 일시 오류는 기억하지 않는다 (다음 호출에 다시 로그인).
    const transient = !progress.sentPassword || progress.portalAccepted
    if (transient && e instanceof LearnUsError && !(e instanceof LoginError)) throw e
    const err =
      e instanceof LoginError ? e : new LoginError(transient ? 'LAYOUT_CHANGED' : 'UNKNOWN_RESULT')
    err.trace = progress.trace
    // 비밀번호를 보낸 뒤의 실패는 종류와 상관없이(네트워크 오류·시간 초과·5xx 포함) 같은 조합으로 다시 보내지 않는다.
    // (보내기 전에 멈춘 실패 — 보안문자, 포털 점검 화면 등 — 는 기억하지 않는다: 잠김 위험이 없다)
    // 포털이 받아들인 뒤의 LoginError(세션이 안 생김 등)는 기억한다: 매 도구 호출마다 로그인을 되풀이하지 않게.
    if (progress.sentPassword && (!progress.portalAccepted || e instanceof LoginError)) {
      rejected = { key, code: err.code, portalMessage: err.portalMessage }
    }
    err.lockoutRisk = progress.sentPassword && !progress.portalAccepted
    throw err
  }
}
