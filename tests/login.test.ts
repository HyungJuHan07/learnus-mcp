// 브라우저 없는 연세포털 로그인 (auth.ts). 가짜 포털로 흐름 전체를 시험한다 — 실제 접속 없음.
// 가짜 페이지 구조는 실제 포털 구조를 따른다.
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET_PW = 'hunter2 é"-must-never-leak'
const RIGHT_PW = 'right-pw'
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
const MODULUS = Buffer.from(publicKey.export({ format: 'jwk' }).n!, 'base64url').toString('hex')
const CHALLENGE = 'ABCDEF0123456789'
// SSO 단계에서 오가는 토큰 (trace·오류 문구에 남으면 안 된다)
const S1 = 'S1-TOKEN-VALUE'
const E3 = 'E3-TOKEN-VALUE'

type PortalPage = { message?: string; retCode?: string; captcha?: 'Y' | 'N'; action?: string }
const portalPage = (o: PortalPage = {}) => `
<html><head><script>
var returnMessage = '${o.message ?? ''}'; var retCode = '${o.retCode ?? ''}'; var pw_fail_cnt = '';
function fSubmitSSOLoginForm2(){ var ssoChallenge= '${CHALLENGE}';
  var rsa = new RSAKey(); rsa.setPublic( '${MODULUS}', '10001' );
  document.ssoLoginForm.E2.value = rsa.encrypt( jsonStr ); document.ssoLoginForm.submit(); }
</script></head><body onload="fInitialize();">
<input type="hidden" id="tap_check" name="tap_check" value="id"/>
<form id="ssoLoginForm" name="ssoLoginForm" method="post" action="${o.action ?? '/sso/PmSSOAuthService'}" onsubmit="return false;">
<input type="hidden" id="app_id" name="app_id" value="ednetYonsei" />
<input type="hidden" id="E2" name="E2" value="" />
<input type="hidden" id="E3" name="E3" value="" />
<input type="hidden" id="captcha_yn" name="captcha_yn" value="${o.captcha ?? 'N'}" />
<input type="text" id="loginId" name="loginId" value="" />
<input type="password" id="loginPasswd" name="loginPasswd" value="" />
</form><form action=""></form></body></html>`

const DASHBOARD = '<html><body id="page-my-courses-dashboard" class="path-my">ok</body></html>'
const LOGGED_OUT = '<html><body id="page-login" class="loginpage notloggedin">login</body></html>'

type Call = { method: string; url: string; body: string; headers: Record<string, string> }

/** 가짜 LearnUs + 포털. correctPw가 맞으면 SSO 왕복 뒤 세션 쿠키를 준다. */
function fakeSites(
  o: {
    correctPw?: string
    captcha?: 'Y'
    evilRedirect?: boolean
    /** 실패 응답이 예상과 다른 모양: failUrl(LearnUs)로 바로 돌려보냄 */
    failToLearnUs?: boolean
    /** 인증 응답이 포털 로그인 화면으로 돌아가는 자동 제출 폼 */
    bounceToPortal?: boolean
    /** 인증 POST에서 네트워크 오류 */
    authNetworkError?: boolean
    /** 인증 POST가 이 HTTP 상태로 끝남 (5xx 등) */
    authStatus?: number
    /** 포털 점검 등으로 로그인 화면이 안 나옴 (비밀번호를 보내기 전 실패) */
    portalDown?: boolean
    /** 실패 화면에 더 얹을 값 (retCode, captcha_yn) */
    fail?: PortalPage
    /** 로그인 폼이 보낼 곳 */
    authAction?: string
    /** 모든 단계는 '성공'인데 LearnUs 세션 쿠키를 주지 않음 */
    noSession?: boolean
    /** 포털이 받아들인 뒤 spLoginProcess.php가 처음 n번 503 (LearnUs 일시 오류) */
    processFailures?: number
    /** 포털이 받아들인 뒤 LearnUs가 동의 화면(/user/policy.php)으로 보냄 */
    policyRedirect?: boolean
  } = {},
) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    const url = new URL(input)
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = String(init.body ?? '')
    calls.push({ method: String(init.method), url: url.href, body, headers })
    const page = (text: string, extra: Record<string, string> = {}) =>
      new Response(text, { status: 200, headers: extra })
    switch (`${init.method} ${url.origin}${url.pathname}`) {
      case 'GET https://ys.learnus.org/login.php':
        return page(LOGGED_OUT)
      case 'GET https://ys.learnus.org/passni/sso/spLogin2.php':
        if (!headers.referer?.endsWith('/login.php')) return page('Incorrect access!!')
        return page(`<body onload="fSSOInitialize();"><script>function fSSOInitialize(){ document.frmSSO.submit(); }</script>
          <form id="frmSSO" name="frmSSO" method="post" action="https://infra.yonsei.ac.kr/sso/PmSSOService">
          <input type="hidden" name="app_id" value="ednetYonsei" /><input type="hidden" name="S1" value="${S1}" /></form></body>`)
      case 'POST https://infra.yonsei.ac.kr/sso/PmSSOService':
        if (o.portalDown) return page('<html><body>시스템 점검 중입니다</body></html>')
        return page(portalPage({ captcha: o.captcha, action: o.authAction }))
      case 'POST https://infra.yonsei.ac.kr/sso/PmSSOAuthService': {
        if (o.authNetworkError) throw new TypeError('fetch failed')
        if (o.authStatus) return new Response('error', { status: o.authStatus })
        if (o.failToLearnUs)
          return new Response('', { status: 302, headers: { location: 'https://ys.learnus.org/' } })
        if (o.bounceToPortal) {
          return page(`<body onload="document.f.submit()"><form name="f" method="post"
            action="https://infra.yonsei.ac.kr/sso/PmSSOService"><input type="hidden" name="app_id" value="x" /></form></body>`)
        }
        const form = new URLSearchParams(body)
        const plain = privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
          Buffer.from(form.get('E2') ?? '', 'hex'),
        ).toString('utf8')
        const { userpw, ssoChallenge } = JSON.parse(plain) as Record<string, string>
        if (userpw !== o.correctPw || ssoChallenge !== CHALLENGE) {
          return page(
            portalPage({
              message: '아이디 또는 비밀번호가 일치하지 않습니다.<br/>[5]회중 [1]회 실패',
              ...o.fail,
            }),
          )
        }
        if (o.evilRedirect)
          return new Response('', { status: 302, headers: { location: 'https://evil.example/' } })
        // 실제 성공 응답: 실패 화면과 같은 이름의 폼이 LearnUs로 간다 (공개된 여러 구현에서 확인)
        return page(`<script>function fInitialize(){ var login_url = 'https://ys.learnus.org/passni/sso/spLoginData.php';
            document.ssoLoginForm.submit(); }</script><body onload="fInitialize();">
          <form id="ssoLoginForm" name="ssoLoginForm" method="post" action="https://ys.learnus.org/passni/sso/spLoginData.php">
          <input type="hidden" id="E3" name="E3" value="${E3}" /><input type="hidden" id="E4" name="E4" value="e4" />
          <input type="hidden" id="S2" name="S2" value="s2" /><input type="hidden" id="CLTID" name="CLTID" value="c" /></form></body>`)
      }
      case 'POST https://ys.learnus.org/passni/sso/spLoginData.php':
        if (new URLSearchParams(body).get('E3') !== E3) return page('bad')
        return page(
          `<script>location.href = '/passni/spLoginProcess.php';</script>`,
          o.noSession ? {} : { 'set-cookie': 'MoodleSession=fresh-session; Path=/; Secure' },
        )
      case 'GET https://ys.learnus.org/passni/spLoginProcess.php':
        if (o.processFailures && o.processFailures-- > 0) return new Response('', { status: 503 })
        if (o.policyRedirect) {
          return new Response('', { status: 303, headers: { location: '/user/policy.php' } })
        }
        return new Response('', { status: 303, headers: { location: '/' } })
      case 'GET https://ys.learnus.org/':
        return page(
          headers.cookie?.includes('MoodleSession=fresh-session') ? DASHBOARD : LOGGED_OUT,
        )
    }
    throw new Error(`unexpected ${init.method} ${url.href}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch }
}

async function loadAuth() {
  vi.resetModules()
  // 요청 사이 1초 쉬는 것을 시험에서는 건너뛴다 (간격 자체는 security.test.ts에서 확인).
  vi.doMock('node:timers/promises', () => ({ setTimeout: async () => {} }))
  return import('../src/auth.ts')
}

const creds = { username: 'tester', password: SECRET_PW }
let out: string[]
beforeEach(() => {
  out = []
  for (const m of ['log', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.doUnmock('node:timers/promises')
})

describe('브라우저 없는 연세포털 로그인', () => {
  it('포털과 같은 방식으로 암호화해 로그인하고 LearnUs 쿠키를 얻는다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW })
    const auth = await loadAuth()
    const jar = await auth.login(creds)
    expect(jar.getCookieStringSync('https://ys.learnus.org/')).toContain(
      'MoodleSession=fresh-session',
    )
    const auth2 = site.calls.find((c) => c.url.endsWith('/PmSSOAuthService'))!
    const form = new URLSearchParams(auth2.body)
    expect(form.get('loginId')).toBe('')
    expect(form.get('loginPasswd')).toBe('')
    expect(auth2.headers.referer).toContain('infra.yonsei.ac.kr')
  })

  it('비밀번호는 암호문으로만 나가고 어디에도 평문으로 남지 않는다', async () => {
    // 틀린 비밀번호, 그리고 SSO를 다 거친 뒤 세션이 없는 실패 (S1·E2·E3가 모두 오간다)
    for (const o of [{ correctPw: 'other' }, { correctPw: SECRET_PW, noSession: true }]) {
      out = []
      const site = fakeSites(o)
      const auth = await loadAuth()
      const err = await auth.login(creds).catch((e: Error) => e)
      expect(err).toBeInstanceOf(auth.LoginError)
      for (const text of site.calls.map((c) => `${c.url} ${c.body} ${JSON.stringify(c.headers)}`)) {
        expect(text).not.toContain(SECRET_PW)
        expect(text).not.toContain(encodeURIComponent(SECRET_PW))
        expect(text).not.toContain(creds.username)
      }
      // 사용자·AI·문제 신고(trace)로 나가는 글에는 아이디와 SSO 토큰도 없다
      const E2 = new URLSearchParams(
        site.calls.find((c) => c.url.endsWith('/PmSSOAuthService'))!.body,
      ).get('E2')!
      expect(E2.length).toBeGreaterThan(100)
      const trace = (err as unknown as { trace: string[] }).trace
      expect(trace.length).toBeGreaterThan(3)
      for (const text of [String(err), (err as Error).stack ?? '', ...trace, ...out]) {
        for (const secret of [SECRET_PW, creds.username, S1, E3, E2]) {
          expect(text).not.toContain(secret)
        }
      }
    }
  })

  it('비밀번호가 틀리면 포털 안내와 함께 실패하고, 같은 비밀번호로는 다시 보내지 않는다', async () => {
    const site = fakeSites({ correctPw: RIGHT_PW })
    const auth = await loadAuth()
    const err = await auth.login(creds).catch((e: Error) => e)
    // 이번에 비밀번호를 보내 실패했다 → 잠김 위험 (ChatGPT는 이때 금고에도 실패를 남긴다)
    expect(err).toMatchObject({ code: 'WRONG_PASSWORD', lockoutRisk: true })
    expect(String(err)).toContain('일치하지 않습니다. [5]회중 [1]회 실패')
    const sent = site.fetch.mock.calls.length
    const again = await auth.login(creds).catch((e: Error) => e)
    // 메모리 재생은 아무것도 보내지 않았다 → 금고 표시를 다시 쓰지 않게 (다시 저장해 지운 표시를 되살리지 않음)
    expect(again).toMatchObject({ code: 'WRONG_PASSWORD', lockoutRisk: false })
    // 두 번째부터도 포털이 알려 준 남은 횟수가 보인다
    expect(String(again)).toContain('[5]회중 [1]회 실패')
    expect(String(again)).toContain('다시 켜면 한 번 더')
    expect(site.fetch.mock.calls.length).toBe(sent)
    await expect(auth.login({ ...creds, password: RIGHT_PW })).resolves.toBeDefined()
  })

  it('보안문자가 켜져 있으면 비밀번호를 보내지 않고 멈춘다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW, captcha: 'Y' })
    const auth = await loadAuth()
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'CAPTCHA' })
    expect(site.calls.some((c) => c.url.endsWith('/PmSSOAuthService'))).toBe(false)
  })

  it('허용된 두 곳(LearnUs·연세포털) 밖으로는 따라가지 않는다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW, evilRedirect: true })
    const auth = await loadAuth()
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    expect(site.calls.every((c) => !c.url.includes('evil.example'))).toBe(true)
  })

  it('알아보지 못한 모양의 실패도 같은 비밀번호로는 다시 보내지 않는다', async () => {
    const site = fakeSites({ failToLearnUs: true })
    const auth = await loadAuth()
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
  })

  it('비밀번호를 보내기 전에 멈춘 실패(포털 점검 등)는 기억하지 않고 다음에 다시 시도한다', async () => {
    const site = fakeSites({ portalDown: true })
    const auth = await loadAuth()
    await expect(auth.login(creds)).rejects.toMatchObject({
      code: 'LAYOUT_CHANGED',
      lockoutRisk: false,
    })
    const first = site.calls.length
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    expect(site.calls.length).toBeGreaterThan(first)
    expect(site.calls.some((c) => c.url.endsWith('/PmSSOAuthService'))).toBe(false)
  })

  it('포털 로그인 화면으로 되돌아와도 그 폼을 다시 제출하지 않는다', async () => {
    const site = fakeSites({ bounceToPortal: true })
    const auth = await loadAuth()
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
  })

  it('로그인 제출(POST) 뒤 네트워크 오류·5xx는 결과를 모르는 실패로 기억하고 다시 보내지 않는다', async () => {
    for (const o of [{ authNetworkError: true }, { authStatus: 500 }, { authStatus: 503 }]) {
      const site = fakeSites({ correctPw: RIGHT_PW, ...o })
      const auth = await loadAuth()
      await expect(auth.login(creds)).rejects.toMatchObject({
        code: 'UNKNOWN_RESULT',
        lockoutRisk: true,
      })
      await expect(auth.login(creds)).rejects.toThrow('로그인 결과를 알려 주지 않았습니다')
      expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
    }
  })

  it('포털이 비밀번호 변경을 요구하거나, 실패 뒤 보안문자를 켜면 그 안내를 보여 준다', async () => {
    for (const [fail, code] of [
      [{ retCode: '[PM_UAN]038' }, 'PASSWORD_EXPIRED'],
      [{ captcha: 'Y' }, 'CAPTCHA'],
    ] as const) {
      const site = fakeSites({ correctPw: RIGHT_PW, fail })
      const auth = await loadAuth()
      await expect(auth.login(creds)).rejects.toMatchObject({ code })
      await expect(auth.login(creds)).rejects.toMatchObject({ code })
      expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
    }
  })

  it('SSO를 다 거쳤어도 LearnUs 세션이 없으면 성공으로 보지 않는다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW, noSession: true })
    const auth = await loadAuth()
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    // 대시보드로 한 번 더 확인했고, 다음 호출에서 비밀번호를 다시 보내지 않는다
    expect(site.calls.filter((c) => c.url === 'https://ys.learnus.org/')).toHaveLength(2)
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'LAYOUT_CHANGED' })
    expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
  })

  it('포털이 받아들인 뒤 LearnUs 쪽 일시 오류는 기억하지 않고 다음 호출에 다시 로그인한다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW, processFailures: 1 })
    const auth = await loadAuth()
    const err = await auth.login(creds).catch((e: Error) => e)
    expect(err).not.toMatchObject({ code: 'UNKNOWN_RESULT' })
    await expect(auth.login(creds)).resolves.toBeDefined()
    expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(2)
  })

  it('도구 호출 하나(오늘 브리핑)에서는 LearnUs 쪽이 계속 실패해도 로그인을 되풀이하지 않는다', async () => {
    for (const o of [{ processFailures: 99 }, { policyRedirect: true }]) {
      const site = fakeSites({ correctPw: SECRET_PW, ...o })
      const auth = await loadAuth()
      const { Client } = await import('../src/client.ts')
      const { todayBriefing } = await import('../src/learnus.ts')
      const client = new Client(() => auth.login(creds))
      await todayBriefing(client.withSignal()).catch(() => {})
      expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
      expect(site.calls.some((c) => c.url.includes('/user/policy.php'))).toBe(false)
    }
  })

  it('로그인 중 열지 않는 화면(동의 화면 등)으로 보내면 브라우저 확인을 안내하고 기억한다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW, policyRedirect: true })
    const auth = await loadAuth()
    // 포털은 비밀번호를 받아들였다 → 잠김 위험 없음 (ChatGPT도 금고에 표시하지 않고 새 대화에서 다시 시도)
    await expect(auth.login(creds)).rejects.toMatchObject({
      code: 'NEEDS_BROWSER',
      lockoutRisk: false,
    })
    await expect(auth.login(creds)).rejects.toMatchObject({ code: 'NEEDS_BROWSER' })
    expect(site.calls.filter((c) => c.url.endsWith('/PmSSOAuthService'))).toHaveLength(1)
  })

  it('로그인 폼이 허용된 세 곳 밖으로 가면 보내지 않는다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW, authAction: '/sso/OtherService' })
    const auth = await loadAuth()
    const err = await auth.login(creds).catch((e: Error) => e)
    expect(err).toMatchObject({ code: 'LAYOUT_CHANGED' })
    expect(String(err)).toContain('github.com/HyungJuHan07/learnus-mcp/issues')
    expect(site.calls.some((c) => c.url.includes('/sso/OtherService'))).toBe(false)
  })

  it('한/영 전환 실수(비밀번호에 한글·전각 글자)는 포털에 보내지 않는다', async () => {
    const site = fakeSites({ correctPw: SECRET_PW })
    const auth = await loadAuth()
    // "hunter2"를 한글 입력 상태로 친 것, 전각(한글 IME 전자 모드)으로 친 것
    for (const typed of ['ㅗㅕㅜㅅㄷㄱ2', 'ｈｕｎｔｅｒ２', 'hunter２']) {
      const err = await auth.login({ ...creds, password: typed }).catch((e: Error) => e)
      expect(err).toMatchObject({ code: 'KOREAN_INPUT' })
      expect(String(err)).toContain('확장 프로그램 → LearnUs')
    }
    expect(site.fetch).not.toHaveBeenCalled()
  })

  it('로그인 정보가 없으면 접속하지 않고 안내한다', async () => {
    const site = fakeSites()
    const auth = await loadAuth()
    delete process.env.LEARNUS_USERNAME
    delete process.env.LEARNUS_PASSWORD
    await expect(auth.login()).rejects.toMatchObject({ code: 'NO_CREDENTIALS' })
    expect(site.fetch).not.toHaveBeenCalled()
  })
})
