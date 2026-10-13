import { setTimeout as sleep } from 'node:timers/promises'
import { CookieJar } from 'tough-cookie'
import { AJAX_FUNCTIONS, AJAX_PATH, BASE_URL, PORTAL_URL, VERSION } from './config.ts'

// 원칙 6. 앞 요청이 끝나고 다음 요청까지 쉬는 시간 (2026-10-13 사용자 결정, 모두 1초에서 줄임):
// 데이터 요청 0.1초, 로그인의 LearnUs 단계 0.2초, 연세포털로 가는 요청은 1초 그대로 —
// 포털은 비밀번호·잠김(5회)·보안문자를 다루고, 비밀번호를 보낸 뒤의 실패는 결과 모름으로 기억돼 사용자를 막는다.
const DATA_INTERVAL_MS = 100
const LOGIN_INTERVAL_MS = 200
// 연세포털로 가는 요청 간격이자, 학교 서버가 힘들다는 신호 뒤의 모든 요청 간격
const SLOW_INTERVAL_MS = 1000
// 연결 오류 뒤 한 번 다시 보내기 전에 쉬는 시간
const RETRY_DELAY_MS = 1000
// 429·503이면 Retry-After만큼(1분~10분) 이 프로세스의 요청을 멈춘다
const PAUSE_MIN_MS = 60_000
const PAUSE_MAX_MS = 600_000
// 도구 호출 하나가 보내는 요청 수 상한 (페이지 구조가 바뀌어 과목 목록이 잘못 늘어나도 폭주하지 않게)
const MAX_REQUESTS_PER_CALL = 40
const TIMEOUT_MS = 15_000
const FILE_TIMEOUT_MS = 120_000
const MAX_FILE_BYTES = 200 * 1024 * 1024
const CACHE_TTL_MS = 10 * 60_000
const MAX_REDIRECTS = 5
const USER_AGENT = `learnus-mcp/${VERSION} (unofficial student project)`

export type Page = { url: string; text: string; contentType: string }
export type FileResponse = Page & { bytes: Buffer }

/** 우리가 쓴 고정 문구의 오류. 사용자·AI에게 그대로 보여도 된다 (주소의 쿼리·입력값은 담지 않는다). */
export class LearnUsError extends Error {}

const TOO_LARGE = `파일이 너무 큽니다 (${MAX_FILE_BYTES / 1024 / 1024}MB 초과). LearnUs에서 직접 받아 주세요.`
const CANCELLED = '요청이 취소되었습니다.'

/** 오류를 보여 줄 글로: 우리 오류면 그 문구, 아니면 fallback (외부 오류 원문은 내보내지 않는다). */
export const userMessage = (e: unknown, fallback: string) =>
  e instanceof LearnUsError ? e.message : fallback

const BLOCKED_PATH =
  /^\/(?:mod\/vod\/|mod\/quiz\/|grade\/|user\/|message\/|report\/|course\/user\.php|login\/logout\.php)/i

/**
 * 열지 않는 화면 (동영상 플레이어·퀴즈·성적·참여자·메시지·보고서(온라인출석부)·로그아웃·과제 제출 화면).
 * 데이터 요청과 로그인 요청의 모든 단계(리다이렉트 포함)에 건다. 웹 서버처럼 퍼센트 인코딩을 풀고
 * 겹친 '/'를 합쳐서 본다. 풀 수 없는 주소는 막는다.
 */
export function assertNotBlocked(url: URL) {
  let path: string
  try {
    // 풀고 나서 역슬래시·'..'도 웹 서버처럼 정리한다
    // ('//'를 먼저 합친다 — 안 그러면 '//mod/…'를 다른 호스트 주소로 읽는다)
    // 풀려서 생긴 ?·#은 다시 %3F·%23으로 (안 그러면 그 뒤를 경로가 아닌 쿼리로 읽어 놓친다)
    const decoded = decodeURIComponent(url.pathname)
      .replace(/\?/g, '%3F')
      .replace(/#/g, '%23')
      .replace(/[\\/]+/g, '/')
    path = new URL(decoded, BASE_URL).pathname
  } catch {
    path = '/user/'
  }
  if (
    BLOCKED_PATH.test(path) ||
    // view.php/추가경로?action=… (PATH_INFO) 형태도 같은 화면이다
    (/^\/mod\/assign\/view\.php(?:\/|$)/i.test(path) && url.searchParams.has('action'))
  ) {
    throw new LearnUsError(`열지 않는 화면이라 요청을 막았습니다: ${url.pathname}`)
  }
}

/**
 * 원칙 1·8 (데이터 요청): LearnUs로 가는 https GET, 또는 허용 목록 AJAX 조회 함수를 부르는 POST만.
 * 실제로 나가는 메서드·주소·본문을 보고 판단한다. 로그인 요청은 auth.ts의 검사를 따로 받는다.
 */
export function assertRequestAllowed(method: string, url: URL, body?: string) {
  if (url.origin !== BASE_URL) {
    throw new LearnUsError(`허용되지 않은 주소로의 요청을 막았습니다: ${url.hostname}`)
  }
  assertNotBlocked(url)
  if (method === 'GET' && body === undefined) return
  if (method === 'POST' && url.pathname === AJAX_PATH && body !== undefined) {
    let calls: unknown
    try {
      calls = JSON.parse(body)
    } catch {
      // 아래에서 막힌다
    }
    if (
      Array.isArray(calls) &&
      calls.length > 0 &&
      calls.every(
        (c: { methodname?: unknown }) =>
          typeof c?.methodname === 'string' && AJAX_FUNCTIONS.has(c.methodname),
      )
    ) {
      return
    }
  }
  throw new LearnUsError(`허용되지 않은 요청을 막았습니다: ${method} ${url.pathname}`)
}

/** 로그인 페이지로 튕겼거나 로그아웃 상태로 그려진 페이지. */
export function looksLoggedOut(page: Page): boolean {
  return (
    new URL(page.url).pathname.startsWith('/login') ||
    /<body[^>]*class="[^"]*\bnotloggedin\b/.test(page.text)
  )
}

// 이 프로세스의 모든 요청(로그인 포함)이 한 줄로 선다 (원칙 6): 동시 1개, 앞 요청이 끝나고
// 데이터 요청 0.1초·로그인의 LearnUs 단계 0.2초·연세포털 1초 뒤 (서버가 힘들다는 신호 뒤로는 모두 1초).
let queue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0
let slowed = false
let pausedUntil = 0

/** 403·429·5xx·차단/점검 화면·시간 초과·연결 오류: 이 프로세스가 끝날 때까지 모든 요청을 1초 간격으로 (다시 줄이지 않는다). */
function slowDown() {
  slowed = true
}

type Kind = 'data' | 'login' | 'portal'
const gapOf = (kind: Kind) =>
  kind === 'portal' || slowed
    ? SLOW_INTERVAL_MS
    : kind === 'data'
      ? DATA_INTERVAL_MS
      : LOGIN_INTERVAL_MS

/** 429·503: Retry-After(초 또는 날짜)만큼, 1분~10분으로 묶어 멈춘다. 이미 더 길게 멈춘 중이면 줄이지 않는다. */
function pause(retryAfter: string | null) {
  const seconds = Number(retryAfter)
  const ms = Number.isNaN(seconds) ? Date.parse(retryAfter ?? '') - Date.now() : seconds * 1000
  pausedUntil = Math.max(
    pausedUntil,
    Date.now() + Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, ms || 0)),
  )
}

const pausedMessage = () =>
  `학교 서버가 요청을 잠시 줄여 달라고 해서 멈췄습니다. ${Math.ceil((pausedUntil - Date.now()) / 60_000)}분 뒤 다시 물어봐 주세요.`

/** 멈춘 동안에는 데이터 요청·새 로그인을 보내지 않는다. */
function assertNotPaused() {
  if (Date.now() < pausedUntil) throw new LearnUsError(pausedMessage())
}

function throttled<T>(kind: Kind, fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + gapOf(kind) - Date.now()
    if (wait > 0) await sleep(wait)
    // 기다리는 사이 앞 요청이 멈춤을 걸었을 수 있다. 로그인 단계는 여기서 막지 않는다
    // (비밀번호 제출 직전에 막히면 보내지 않은 것을 '결과 모름'으로 잘못 기억한다 — 로그인 시작 전에 Client가 본다).
    if (kind === 'data') assertNotPaused()
    try {
      return await fn()
    } finally {
      lastRequestAt = Date.now()
    }
  })
  queue = run.catch(() => {})
  return run
}

type Guard = (method: string, url: URL, body?: string) => void
type RequestOptions = {
  guard: Guard
  body?: string
  /** body가 폼(application/x-www-form-urlencoded)이면 true, 아니면 JSON. */
  form?: boolean
  referer?: string
  /** 파일 받기: 본문을 바이트로 (크기 제한·긴 제한 시간). */
  binary?: boolean
  /** 도구 호출이 취소되면 대기 중·진행 중 요청을 멈춘다 (로그인 요청에는 쓰지 않는다). */
  signal?: AbortSignal
}

/** 학교 서버로 가는 모든 요청이 지나는 유일한 지점. guard가 허용한 곳만, 리다이렉트도 그 안에서만 따라간다. */
export async function request(
  jar: CookieJar,
  method: 'GET' | 'POST',
  url: string,
  o: RequestOptions,
): Promise<FileResponse> {
  let current = new URL(url)
  let body = o.body
  // 데이터 guard를 거친 요청만 0.1초. 그 밖(로그인)은 LearnUs 0.2초·연세포털 1초 (리다이렉트 단계마다 다시 본다).
  const data = o.guard === assertRequestAllowed
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    o.guard(method, current, body)
    // 데이터 요청이 로그인 화면으로 넘겨졌으면(세션 만료) 그 화면은 받지 않는다 — 주소만으로 만료를 안다 (looksLoggedOut).
    // guard 뒤에 본다: 막힌 화면(/login/logout.php 등)으로 넘기면 지금처럼 막혀야 한다.
    if (data && hop > 0 && current.pathname.startsWith('/login')) {
      return { url: current.href, contentType: '', text: '', bytes: Buffer.alloc(0) }
    }
    const kind: Kind = data ? 'data' : current.origin === PORTAL_URL ? 'portal' : 'login'
    const res = await throttled(kind, () => fetchOnce(method, current, jar, body, o))
    for (const sc of res.headers.getSetCookie()) {
      jar.setCookieSync(sc, current.href, { ignoreError: true })
    }
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current)
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET'
        body = undefined
      }
      continue
    }
    // 403은 차단(WAF)일 수 있다
    if (res.status === 403 || res.status === 429 || res.status >= 500) slowDown()
    if (res.status === 429 || res.status === 503) {
      pause(res.headers.get('retry-after'))
      throw new LearnUsError(pausedMessage())
    }
    if (res.status < 200 || res.status >= 300) {
      throw new LearnUsError(`LearnUs 응답 오류 ${res.status} (${current.pathname})`)
    }
    const contentType = res.headers.get('content-type') ?? ''
    // 파일이라도 로그인 화면(HTML)이 오면 글로 읽어 만료를 알아챌 수 있게 한다.
    const text = !o.binary || contentType.includes('text/html') ? res.bytes.toString('utf8') : ''
    // 페이지는 글만 남긴다 (캐시에 바이트까지 두 벌 들고 있지 않게).
    const bytes = o.binary ? res.bytes : Buffer.alloc(0)
    return { url: current.href, contentType, text, bytes }
  }
  throw new LearnUsError('리다이렉트가 너무 많습니다.')
}

/** 본문까지 다 받아야 끝난다 → 동시 1개·제한 시간이 전송 전체에 걸린다. */
async function fetchOnce(
  method: string,
  url: URL,
  jar: CookieJar,
  body: string | undefined,
  o: RequestOptions,
) {
  const attempt = async () => {
    // 대기열에서 나가기 직전: 취소된 도구 호출의 요청은 보내지 않는다.
    if (o.signal?.aborted) throw new LearnUsError(CANCELLED)
    const timeout = AbortSignal.timeout(o.binary ? FILE_TIMEOUT_MS : TIMEOUT_MS)
    const res = await fetch(url, {
      method,
      body,
      redirect: 'manual',
      signal: o.signal ? AbortSignal.any([timeout, o.signal]) : timeout,
      headers: {
        cookie: jar.getCookieStringSync(url.href),
        'user-agent': USER_AGENT,
        ...(o.referer && { referer: o.referer }),
        ...(body !== undefined && {
          'content-type': o.form ? 'application/x-www-form-urlencoded' : 'application/json',
        }),
      },
    })
    if (Number(res.headers.get('content-length')) > MAX_FILE_BYTES) {
      await res.body?.cancel()
      throw new LearnUsError(TOO_LARGE)
    }
    // 크기 표시가 없거나 틀려도 받으면서 센다. 넘으면 루프를 빠져나가며 스트림이 취소된다.
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of res.body ?? []) {
      size += chunk.length
      if (size > MAX_FILE_BYTES) throw new LearnUsError(TOO_LARGE)
      chunks.push(chunk)
    }
    return { status: res.status, headers: res.headers, bytes: Buffer.concat(chunks) }
  }
  // 원래 오류 메시지는 주소를 담을 수 있어 버린다.
  const fail = (e: unknown) =>
    o.signal?.aborted
      ? new LearnUsError(CANCELLED)
      : e instanceof LearnUsError
        ? e
        : (e as Error)?.name === 'TimeoutError'
          ? new LearnUsError(
              o.binary
                ? '파일 받기가 너무 오래 걸립니다 (2분 초과). 큰 파일이면 LearnUs에서 직접 받아 주세요.'
                : 'LearnUs 응답이 너무 늦습니다 (시간 초과). 잠시 뒤 다시 시도해 주세요.',
            )
          : new LearnUsError('LearnUs에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')
  try {
    return await attempt()
  } catch (e) {
    // 시간 초과·연결 오류는 학교 서버가 힘들다는 신호일 수 있다
    if (!(e instanceof LearnUsError) && !o.signal?.aborted) slowDown()
    // 페이지 GET의 연결 오류만 1회 재시도 (원칙 6). 다시 보내지 않는 것:
    // POST(로그인 폼·AJAX — 같은 암호문이 두 번 갈 수 있다), 파일·시간 초과(큰 파일을 두 번 받거나
    // 대기열을 오래 막는다), 취소, 우리 오류(크기 초과 등).
    if (
      method !== 'GET' ||
      o.binary ||
      (e as Error)?.name === 'TimeoutError' ||
      e instanceof LearnUsError ||
      o.signal?.aborted
    ) {
      throw fail(e)
    }
    await sleep(RETRY_DELAY_MS)
    try {
      return await attempt()
    } catch (e2) {
      throw fail(e2)
    }
  }
}

/** 실제 LearnUs(Moodle) 페이지는 로그아웃 상태에도 M.cfg가 있고 body id가 "page-…"다. */
const moodlePage = (page: Page) =>
  page.text.includes('M.cfg') || /<body[^>]*\bid="page-/.test(page.text)

/** 로그인이 마지막에 받은 화면 (auth.ts가 넣는다). relogin이 대시보드(/)면 새 세션의 캐시에 넣어 곧바로 다시 받지 않는다. */
export const loginHome = new WeakMap<CookieJar, Page>()

// 예상과 다른 200 화면 (점검·오류 페이지·JSON 등). 캐시하지 않는다.
const UNEXPECTED_PAGE =
  'LearnUs가 예상과 다른 화면을 보냈습니다 (점검 중일 수 있음). 잠시 뒤 다시 시도해 주세요.'

/** 한 로그인 세션의 상태. withSignal로 만든 클라이언트들이 같은 것을 함께 쓴다. */
type Session = {
  jar: CookieJar
  // 로그인할 때마다 1씩 오른다. 옛 세션으로 보낸 요청의 응답이 다시 로그인을 부르지 않게 한다.
  gen: number
  loginInFlight?: Promise<void>
  cache: Map<string, { at: number; page: Page }>
  login: () => Promise<CookieJar>
}

/** 로그인된 LearnUs 세션. 쿠키는 메모리에만 두고, 만료되면 다시 로그인한다. */
export class Client {
  private s: Session
  private signal?: AbortSignal
  // 이 클라이언트(도구 호출 하나)에서 시작한 첫 로그인·재로그인. 실패해도 같은 호출 안에서는
  // 다시 로그인하지 않는다 (원칙 6: 자동 로그인 재시도 최대 1회).
  private firstLogin?: Promise<void>
  private renewed?: Promise<void>
  private genAfterRenew?: number
  // 이 클라이언트(도구 호출 하나)가 보낸 요청 수 (MAX_REQUESTS_PER_CALL)
  private requests = 0

  constructor(login: () => Promise<CookieJar>) {
    this.s = { jar: new CookieJar(), gen: 0, cache: new Map(), login }
  }

  /** 도구 호출 하나에 쓰는 같은 세션의 클라이언트. signal이 취소되면 그 뒤 요청을 보내지 않는다. */
  withSignal(signal?: AbortSignal): Client {
    const c = new Client(this.s.login)
    c.s = this.s
    c.signal = signal
    return c
  }

  /** 페이지 GET (10분 캐시). */
  async get(url: string, opts: { cache?: boolean } = {}): Promise<Page> {
    // 첫 로그인을 먼저 한다: 로그인이 받아 온 대시보드를 캐시에서 쓰려고
    if (this.s.gen === 0) {
      this.checkSignal()
      await (this.firstLogin ??= this.relogin())
    }
    const hit = this.s.cache.get(url)
    if (opts.cache !== false && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.page
    const page = await this.getLoggedIn(url, false)
    // Moodle 페이지가 아니면(점검 화면·JSON 등) '없음'으로 잘못 읽히지 않게 멈춘다.
    if (!moodlePage(page)) {
      // 200으로 오는 차단·점검 화면일 수 있어 늦춘다
      slowDown()
      throw new LearnUsError(UNEXPECTED_PAGE)
    }
    this.s.cache.set(url, { at: Date.now(), page })
    return page
  }

  /** 파일 받기 (캐시 없음). */
  getFile(url: string): Promise<FileResponse> {
    return this.getLoggedIn(url, true)
  }

  /** ajax.ts 전용. 본문의 함수 이름은 assertRequestAllowed가 다시 검사한다. */
  async postAjax(url: string, calls: object[]): Promise<{ text: string; gen: number }> {
    const { res, gen } = await this.send('POST', url, { body: JSON.stringify(calls) })
    return { text: res.text, gen }
  }

  /** gen 세션으로 보낸 요청이 로그아웃 상태를 받았을 때. 그 사이 새로 로그인했으면 그걸 기다리기만 한다. */
  async renew(gen: number): Promise<void> {
    this.checkSignal()
    if (this.s.gen !== gen) return this.s.loginInFlight
    // 이 호출의 재로그인 몫을 이미 썼는데 새 세션도 끊겼으면, 죽은 세션으로 더 보내지 않고 멈춘다
    if (this.genAfterRenew === gen) {
      throw new LearnUsError('LearnUs 세션이 다시 끊겼습니다. 잠시 뒤 다시 물어봐 주세요.')
    }
    return (this.renewed ??= this.relogin().then(() => {
      this.genAfterRenew = this.s.gen
    }))
  }

  /** 동시에 여러 요청이 만료를 만나도 로그인은 한 번만. */
  relogin(): Promise<void> {
    const s = this.s
    // 멈춘 동안에는 로그인도 새로 시작하지 않는다 (이미 진행 중인 로그인은 그대로 끝낸다)
    if (!s.loginInFlight && Date.now() < pausedUntil) {
      return Promise.reject(new LearnUsError(pausedMessage()))
    }
    s.loginInFlight ??= (async () => {
      s.cache.clear()
      s.jar = await s.login()
      s.gen++
      // 로그인이 대시보드에서 끝났으면 그 화면을 새 세션의 캐시에 (곧바로 같은 / 를 다시 받지 않게)
      const home = loginHome.get(s.jar)
      loginHome.delete(s.jar)
      if (home?.url === `${BASE_URL}/` && moodlePage(home) && !looksLoggedOut(home)) {
        s.cache.set(home.url, { at: Date.now(), page: home })
      }
    })().finally(() => (s.loginInFlight = undefined))
    return s.loginInFlight
  }

  /** 취소된 도구 호출이면 로그인·요청을 새로 시작하지 않는다. */
  private checkSignal() {
    if (this.signal?.aborted) throw new LearnUsError(CANCELLED)
  }

  /** 세션이 만료됐으면(로그인 화면이 오면) 자동 로그인 1회 후 다시 요청한다. */
  private async getLoggedIn(url: string, binary: boolean): Promise<FileResponse> {
    const first = await this.send('GET', url, { binary })
    if (!looksLoggedOut(first.res)) return first.res
    await this.renew(first.gen)
    // 다시 로그인하며 받은 대시보드면 다시 받지 않는다 (relogin이 캐시를 비운 뒤 새 세션으로 넣은 것)
    const hit = binary ? undefined : this.s.cache.get(url)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.page, bytes: Buffer.alloc(0) }
    const { res } = await this.send('GET', url, { binary })
    if (looksLoggedOut(res)) {
      throw new LearnUsError('다시 로그인했지만 LearnUs가 로그인 화면을 돌려줬습니다.')
    }
    return res
  }

  private async send(method: 'GET' | 'POST', url: string, o: { body?: string; binary?: boolean }) {
    this.checkSignal()
    if (++this.requests > MAX_REQUESTS_PER_CALL) {
      throw new LearnUsError(
        `한 번에 보내는 요청이 너무 많아(${MAX_REQUESTS_PER_CALL}개 초과) 멈췄습니다. 과목을 정해 다시 물어봐 주세요.`,
      )
    }
    if (this.s.gen === 0) await (this.firstLogin ??= this.relogin())
    const gen = this.s.gen
    const res = await request(this.s.jar, method, url, {
      ...o,
      guard: assertRequestAllowed,
      signal: this.signal,
    })
    return { res, gen }
  }
}
