// 보안 테스트 (AGENTS.md 절대 원칙). CI 필수. LearnUs에 접속하지 않는다 (fetch는 가짜).
import { CookieJar } from 'tough-cookie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scan } from '../scripts/check-secrets.ts'

const SECRET_COOKIE = 'cookie-value-that-must-never-leak'
// 실제 LearnUs 페이지처럼 M.cfg가 있다 (없으면 예상과 다른 화면으로 본다)
const LOGGED_IN =
  '<html><body class="pagelayout-mydashboard">ok <script>M.cfg = {"sesskey":"fake"};</script></body></html>'
const LOGGED_OUT = '<html><body id="page-login" class="loginpage notloggedin">login</body></html>'

function sessionJar() {
  const jar = new CookieJar()
  jar.setCookieSync(`MoodleSession=${SECRET_COOKIE}; Secure; Path=/`, 'https://ys.learnus.org/')
  return jar
}
const html = (text: string, init: ResponseInit = {}) => new Response(text, { status: 200, ...init })

async function load() {
  vi.resetModules()
  return import('../src/client.ts')
}

afterEach(() => vi.unstubAllGlobals())

describe('요청 허용 검사 (원칙 1·8)', async () => {
  const client = await load()
  const ok = (m: string, u: string, b?: string) => () =>
    client.assertRequestAllowed(m, new URL(u), b)
  const ajax = (...names: string[]) =>
    JSON.stringify(names.map((methodname, index) => ({ index, methodname, args: {} })))
  const AJAX = 'https://ys.learnus.org/lib/ajax/service.php?sesskey=x'
  const ALLOWED_FN = 'core_calendar_get_action_events_by_timesort'

  it('허용 도메인의 https GET만 통과', () => {
    expect(ok('GET', 'https://ys.learnus.org/my/')).not.toThrow()
    expect(ok('GET', 'http://ys.learnus.org/my/')).toThrow(client.LearnUsError)
    expect(ok('GET', 'https://evil.example/')).toThrow(client.LearnUsError)
    expect(ok('GET', 'https://ys.learnus.org.evil.example/')).toThrow(client.LearnUsError)
    expect(ok('GET', 'https://infra.yonsei.ac.kr/sso/')).toThrow(client.LearnUsError)
    expect(ok('GET', 'https://ys.learnus.org/my/', 'x')).toThrow(client.LearnUsError)
  })

  it('POST는 허용 목록의 AJAX 조회 함수만', () => {
    expect(ok('POST', AJAX, ajax(ALLOWED_FN))).not.toThrow()
    expect(ok('POST', AJAX, ajax('core_message_send_instant_messages'))).toThrow()
    expect(ok('POST', AJAX, ajax(ALLOWED_FN, 'mod_assign_save_submission'))).toThrow()
    expect(ok('POST', AJAX, '[]')).toThrow()
    expect(ok('POST', AJAX, 'not json')).toThrow()
    expect(ok('POST', AJAX)).toThrow()
    expect(ok('POST', 'https://ys.learnus.org/mod/assign/view.php', ajax(ALLOWED_FN))).toThrow()
    // 함수 이름은 문자열일 때만 (배열 등은 거부)
    const arrayName = JSON.stringify([{ index: 0, methodname: [ALLOWED_FN], args: {} }])
    expect(ok('POST', AJAX, arrayName)).toThrow()
  })

  it('열지 않는 화면(동영상·퀴즈·성적·참여자·메시지·보고서·로그아웃·과제 제출)은 GET도 거부', () => {
    for (const u of [
      'https://ys.learnus.org/mod/vod/viewer.php?id=1',
      'https://ys.learnus.org/mod/vod/view.php?id=1',
      'https://ys.learnus.org//mod/vod/viewer.php?id=1',
      'https://ys.learnus.org/mod/./vod/viewer.php?id=1',
      'https://ys.learnus.org/mod/%2e/vod/viewer.php?id=1',
      'https://ys.learnus.org/MOD/VOD/viewer.php?id=1',
      'https://ys.learnus.org/mod/quiz/view.php?id=1',
      'https://ys.learnus.org/mod/quiz/attempt.php?attempt=1',
      'https://ys.learnus.org/grade/report/user/index.php?id=1',
      'https://ys.learnus.org/user/index.php?id=1',
      'https://ys.learnus.org/message/index.php',
      'https://ys.learnus.org/report/log/index.php?id=1',
      'https://ys.learnus.org/login/logout.php?sesskey=x',
      'https://ys.learnus.org/mod/assign/view.php?id=1&action=editsubmission',
      'https://ys.learnus.org/mod/assign/view.php?action=submit&id=1',
      // 퍼센트 인코딩·PATH_INFO 우회
      'https://ys.learnus.org/mod/v%6Fd/viewer.php?id=1',
      'https://ys.learnus.org/%67rade/report/index.php',
      'https://ys.learnus.org/report/ubcompletion/progress.php?id=1',
      'https://ys.learnus.org/mod/assign/view.php/x?action=editsubmission',
      'https://ys.learnus.org/mod/assign/view%2Ephp?id=1&action=editsubmission',
      'https://ys.learnus.org/mod/%E0%A4%A/x',
      'https://ys.learnus.org/mod/folder/..%2f..%2fmod/vod/viewer.php?id=1',
      'https://ys.learnus.org/mod%5cvod%5cviewer.php?id=1',
      'https://ys.learnus.org/course/user.php?mode=grade&id=1',
      'https://ys.learnus.org/x%3F%2F..%2Fmod/vod/viewer.php?id=1',
      'https://ys.learnus.org/x%23%2F..%2Fmod/vod/viewer.php?id=1',
    ]) {
      expect(ok('GET', u), u).toThrow(client.LearnUsError)
    }
    for (const u of [
      'https://ys.learnus.org/',
      'https://ys.learnus.org/mod/assign/view.php?id=1',
      'https://ys.learnus.org/mod/folder/view.php?id=1',
      'https://ys.learnus.org/login/index.php',
      'https://ys.learnus.org/pluginfile.php/1/mod_folder/content/0/user.pdf',
    ]) {
      expect(ok('GET', u), u).not.toThrow()
    }
  })

  it('로그인 중 POST는 SSO 폼 제출 세 곳만', async () => {
    const { assertLoginRequest } = await import('../src/auth.ts')
    const login = (m: string, u: string) => () => assertLoginRequest(m, new URL(u))
    for (const u of [
      'https://infra.yonsei.ac.kr/sso/PmSSOService',
      'https://infra.yonsei.ac.kr/sso/PmSSOAuthService',
      'https://ys.learnus.org/passni/sso/spLoginData.php',
    ]) {
      expect(login('POST', u), u).not.toThrow()
      expect(login('GET', u), u).not.toThrow()
    }
    for (const u of [
      'https://infra.yonsei.ac.kr/sso/OtherService',
      'https://ys.learnus.org/sso/PmSSOAuthService',
      'https://infra.yonsei.ac.kr/passni/sso/spLoginData.php',
      'https://ys.learnus.org/lib/ajax/service.php',
      'https://ys.learnus.org/mod/assign/view.php',
      'https://evil.example/sso/PmSSOService',
    ]) {
      expect(login('POST', u), u).toThrow()
    }
    // 로그인 중 리다이렉트도 열지 않는 화면에는 가지 않는다
    expect(login('GET', 'https://ys.learnus.org/mod/vod/viewer.php?id=1')).toThrow()
    expect(login('GET', 'https://ys.learnus.org/login/logout.php?sesskey=x')).toThrow()
    expect(login('GET', 'http://infra.yonsei.ac.kr/sso/PmSSOService')).toThrow()
    expect(login('PUT', 'https://infra.yonsei.ac.kr/sso/PmSSOService')).toThrow()
  })

  it('PUT·PATCH·DELETE는 항상 거부', () => {
    for (const m of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(ok(m, 'https://ys.learnus.org/my/')).toThrow(client.LearnUsError)
    }
  })
})

describe('HTTP 클라이언트', () => {
  /** 응답 목록 대신 Error를 넣으면 그 요청은 그 오류로 실패한다. */
  async function setup(responses: (Response | Error)[]) {
    const mod = await load()
    const calls: { url: string; init: RequestInit; at: number }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), init, at: Date.now() })
        const r = responses.shift()
        if (!r) throw new TypeError('no more responses')
        if (r instanceof Error) throw r
        return r
      }),
    )
    const login = vi.fn(async () => sessionJar())
    return { c: new mod.Client(login), calls, login }
  }

  it('허용 도메인 밖으로의 리다이렉트는 따라가지 않는다', async () => {
    const { c, calls } = await setup([
      html('', { status: 302, headers: { location: 'https://evil.example/steal' } }),
    ])
    await expect(c.get('https://ys.learnus.org/my/')).rejects.toThrow('evil.example')
    expect(calls.map((x) => new URL(x.url).hostname)).toEqual(['ys.learnus.org'])
  })

  it('리다이렉트로도 열지 않는 화면에는 가지 않는다', async () => {
    const { c, calls } = await setup([
      html('', { status: 303, headers: { location: '/mod/vod/viewer.php?id=1' } }),
    ])
    await expect(c.get('https://ys.learnus.org/mod/folder/view.php?id=1')).rejects.toThrow(
      '열지 않는 화면',
    )
    expect(calls).toHaveLength(1)
  })

  it('허용 도메인 안의 리다이렉트는 쿠키를 들고 따라간다', async () => {
    const { c, calls } = await setup([
      html('', { status: 303, headers: { location: '/my/index.php' } }),
      html(LOGGED_IN),
    ])
    const page = await c.get('https://ys.learnus.org/my/')
    expect(page.url).toBe('https://ys.learnus.org/my/index.php')
    const cookie = (calls[1].init.headers as Record<string, string>).cookie
    expect(cookie).toContain('MoodleSession=')
  }, 10_000)

  it('세션 만료 → 자동 로그인 1회 → 원래 요청 재시도', async () => {
    const { c, login, calls } = await setup([html(LOGGED_OUT), html(LOGGED_IN)])
    const page = await c.get('https://ys.learnus.org/my/')
    expect(page.text).toContain('pagelayout-mydashboard')
    expect(login).toHaveBeenCalledTimes(2) // 처음 로그인 + 만료 뒤 1번
    expect(calls).toHaveLength(2)
  }, 10_000)

  it('다시 로그인해도 로그아웃 상태면 더 시도하지 않고 오류', async () => {
    const { c, login } = await setup([html(LOGGED_OUT), html(LOGGED_OUT), html(LOGGED_IN)])
    await expect(c.get('https://ys.learnus.org/my/')).rejects.toThrow('로그인 화면')
    expect(login).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('도구 호출 하나(withSignal)에서 로그인 실패는 되풀이하지 않는다 (다음 호출에서만 다시)', async () => {
    const { c } = await setup([])
    const login = vi.fn(async (): Promise<CookieJar> => {
      throw new (await load()).LearnUsError('LearnUs 응답 오류 503')
    })
    ;(c as unknown as { s: { login: unknown } }).s.login = login
    const call = c.withSignal()
    await expect(call.get('https://ys.learnus.org/a')).rejects.toThrow('503')
    await expect(call.get('https://ys.learnus.org/b')).rejects.toThrow('503')
    expect(login).toHaveBeenCalledTimes(1)
    await expect(c.withSignal().get('https://ys.learnus.org/a')).rejects.toThrow('503')
    expect(login).toHaveBeenCalledTimes(2)
  })

  it('도구 호출 하나에서 재로그인은 한 번까지 (페이지가 계속 로그아웃이어도)', async () => {
    const { c, login, calls } = await setup([
      html(LOGGED_OUT),
      html(LOGGED_OUT),
      html(LOGGED_OUT),
      html(LOGGED_OUT),
    ])
    const call = c.withSignal()
    await expect(call.get('https://ys.learnus.org/a')).rejects.toThrow('로그인 화면')
    // 재로그인 몫을 썼으니 죽은 세션으로 또 보내지 않고 바로 멈춘다
    await expect(call.get('https://ys.learnus.org/b')).rejects.toThrow('다시 끊겼습니다')
    expect(login).toHaveBeenCalledTimes(2) // 첫 로그인 + 재로그인 1번
    expect(calls).toHaveLength(3)
  }, 10_000)

  it('동시에 만료를 만나도 로그인은 한 번', async () => {
    const { c, login } = await setup([])
    await Promise.all([c.relogin(), c.relogin(), c.relogin()])
    expect(login).toHaveBeenCalledTimes(1)
  })

  it('이미 새로 로그인한 뒤 도착한 옛 세션의 응답은 로그인을 다시 부르지 않는다', async () => {
    const { c, login } = await setup([])
    await c.relogin()
    await c.renew(0)
    expect(login).toHaveBeenCalledTimes(1)
  })

  it('요청 사이 최소 0.1초, 같은 주소는 캐시', async () => {
    const { c, calls } = await setup([html(LOGGED_IN), html(LOGGED_IN)])
    await Promise.all([c.get('https://ys.learnus.org/a'), c.get('https://ys.learnus.org/b')])
    await c.get('https://ys.learnus.org/a')
    expect(calls).toHaveLength(2)
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(90)
  }, 10_000)

  it('동시 1개, 앞 응답이 끝나고 0.1초 뒤에 다음 데이터 요청을 보낸다', async () => {
    const mod = await load()
    const spans: { start: number; end: number }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const span = { start: Date.now(), end: 0 }
        spans.push(span)
        await new Promise((r) => setTimeout(r, 50))
        span.end = Date.now()
        return html(LOGGED_IN)
      }),
    )
    const c = new mod.Client(async () => sessionJar())
    await Promise.all(['a', 'b', 'c'].map((p) => c.get(`https://ys.learnus.org/${p}`)))
    expect(spans).toHaveLength(3)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start - spans[i - 1].end).toBeGreaterThanOrEqual(95)
    }
  }, 10_000)

  it.each([500, 403])(
    '%d 뒤로는 그 프로세스의 데이터 요청 간격을 계속 1초로 되돌린다',
    async (status) => {
      const { c, calls } = await setup([html('', { status }), html(LOGGED_IN), html(LOGGED_IN)])
      await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow(`응답 오류 ${status}`)
      await c.withSignal().get('https://ys.learnus.org/b')
      await c.withSignal().get('https://ys.learnus.org/c')
      expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(990)
      expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(990)
    },
    10_000,
  )

  it('서버가 힘들다는 신호 뒤로는 로그인의 LearnUs 단계도 1초 간격', async () => {
    const { c, calls } = await setup([html('', { status: 500 }), html(LOGGED_IN)])
    await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow('응답 오류 500')
    const mod = await import('../src/client.ts')
    // 로그인 단계처럼 데이터 guard가 아닌 요청 (평소 0.2초)
    await mod.request(sessionJar(), 'GET', 'https://ys.learnus.org/login.php', { guard: () => {} })
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(990)
  }, 10_000)

  it.each([
    ['대시보드(/)', 'https://ys.learnus.org/', LOGGED_IN, 0],
    ['다른 주소(/my/)', 'https://ys.learnus.org/my/', LOGGED_IN, 1],
    ['Moodle 화면이 아님', 'https://ys.learnus.org/', '<html>점검</html>', 1],
  ])('로그인이 받은 화면은 %s일 때만 캐시에 넣는다', async (_, url, text, sent) => {
    const mod = await load()
    const fetch = vi.fn(async () => html(LOGGED_IN))
    vi.stubGlobal('fetch', fetch)
    const c = new mod.Client(async () => {
      const jar = sessionJar()
      mod.loginHome.set(jar, { url, text, contentType: 'text/html' })
      return jar
    })
    await c.get('https://ys.learnus.org/')
    expect(fetch).toHaveBeenCalledTimes(sent)
  })

  it('세션이 끊겨 다시 로그인하면, 로그인이 받은 대시보드로 답하고 / 를 다시 받지 않는다', async () => {
    const mod = await load()
    const fetch = vi.fn(async () => html(LOGGED_OUT))
    vi.stubGlobal('fetch', fetch)
    let logins = 0
    const c = new mod.Client(async () => {
      const jar = sessionJar()
      if (logins++ > 0) {
        mod.loginHome.set(jar, {
          url: 'https://ys.learnus.org/',
          text: LOGGED_IN,
          contentType: 'text/html',
        })
      }
      return jar
    })
    await c.relogin()
    expect((await c.get('https://ys.learnus.org/', { cache: false })).text).toBe(LOGGED_IN)
    expect(fetch).toHaveBeenCalledOnce()
    expect(logins).toBe(2)
  })

  it('데이터 요청이 로그인 화면으로 넘겨지면 그 화면은 받지 않고 다시 로그인한다', async () => {
    const { c, calls, login } = await setup([
      html('', { status: 303, headers: { location: '/login/index.php' } }),
      html(LOGGED_IN),
    ])
    await c.get('https://ys.learnus.org/course/view.php?id=1')
    expect(calls.map((x) => new URL(x.url).pathname)).toEqual([
      '/course/view.php',
      '/course/view.php',
    ])
    expect(login).toHaveBeenCalledTimes(2)
  })

  it('막힌 화면(로그아웃)으로 넘겨지면 지금처럼 막고, 다시 로그인하지 않는다', async () => {
    const { c, calls, login } = await setup([
      html('', { status: 303, headers: { location: '/login/logout.php?sesskey=x' } }),
    ])
    await expect(c.get('https://ys.learnus.org/course/view.php?id=1')).rejects.toThrow(
      '열지 않는 화면',
    )
    expect(calls).toHaveLength(1)
    expect(login).toHaveBeenCalledOnce()
  })

  it('200으로 온 차단·점검 화면 뒤로도 1초 간격', async () => {
    const { c, calls } = await setup([html('<html><body>차단</body></html>'), html(LOGGED_IN)])
    await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow('예상과 다른 화면')
    await c.get('https://ys.learnus.org/b')
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(990)
  }, 10_000)

  it('연결 오류가 두 번 이어지면 더 보내지 않는다 (재시도는 한 번만)', async () => {
    const { c, calls } = await setup([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      html(LOGGED_IN),
    ])
    await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow('연결하지 못했습니다')
    expect(calls).toHaveLength(2)
  }, 10_000)

  it('연결 오류는 1초 쉬고 한 번만 다시 보내고, 그 뒤로는 1초 간격', async () => {
    const { c, calls } = await setup([
      new TypeError('fetch failed'),
      html(LOGGED_IN),
      html(LOGGED_IN),
    ])
    await c.get('https://ys.learnus.org/a')
    await c.get('https://ys.learnus.org/b')
    expect(calls).toHaveLength(3)
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(990)
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(990)
  }, 10_000)

  it('429·503이면 멈추고, 그동안 데이터 요청·새 로그인을 보내지 않는다', async () => {
    const { c, calls, login } = await setup([
      html('', { status: 503, headers: { 'retry-after': '120' } }),
      html(LOGGED_IN),
      html(LOGGED_IN),
    ])
    await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow('2분 뒤 다시')
    await expect(c.get('https://ys.learnus.org/b')).rejects.toThrow('멈췄습니다')
    await expect(c.withSignal().relogin()).rejects.toThrow('멈췄습니다')
    expect(calls).toHaveLength(1)
    expect(login).toHaveBeenCalledOnce()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 121_000)
    try {
      await c.get('https://ys.learnus.org/b')
      // 멈춤이 끝난 뒤에도 간격은 1초 (늦춘 채로)
      const t = performance.now()
      await c.get('https://ys.learnus.org/c')
      expect(performance.now() - t).toBeGreaterThanOrEqual(990)
    } finally {
      clock.mockRestore()
    }
    expect(calls).toHaveLength(3)
  }, 10_000)

  it('멈춤이 걸리면 이미 대기열에 선 데이터 요청도 보내지 않는다', async () => {
    const { c, calls } = await setup([html('', { status: 503 }), html(LOGGED_IN), html(LOGGED_IN)])
    const r = await Promise.allSettled(
      ['a', 'b', 'c'].map((p) => c.get(`https://ys.learnus.org/${p}`)),
    )
    expect(calls).toHaveLength(1)
    for (const x of r) expect(String((x as PromiseRejectedResult).reason)).toContain('멈췄습니다')
  })

  it('멈춘 동안 더 짧은 멈춤 신호가 와도 줄이지 않는다', async () => {
    const mod = await load()
    const responses = [
      html('', { status: 503, headers: { 'retry-after': '600' } }),
      html('', { status: 429 }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift()!),
    )
    const c = new mod.Client(async () => sessionJar())
    await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow('10분 뒤')
    // 진행 중이던 로그인 단계(멈춤 검사 없음)가 헤더 없는 429를 받은 경우
    await expect(
      mod.request(sessionJar(), 'GET', 'https://ys.learnus.org/login.php', { guard: () => {} }),
    ).rejects.toThrow('10분 뒤')
  }, 10_000)

  it.each([
    ['1', 60_000],
    ['86400', 600_000],
    ['later', 60_000],
    ['(5분 뒤 날짜)', 300_000],
  ])('Retry-After %s → 1분~10분으로 묶어 %dms 멈춘다', async (retryAfter, ms) => {
    // 날짜 형식은 실행할 때 만든다 (모듈을 읽을 때 만들면 앞 시험이 쓴 시간만큼 짧아진다)
    const date = retryAfter.startsWith('(')
    const header = date ? new Date(Date.now() + 300_000).toUTCString() : retryAfter
    const { c, calls } = await setup([
      html('', { status: 429, headers: { 'retry-after': header } }),
      html(LOGGED_IN),
    ])
    const t0 = Date.now()
    await expect(c.get('https://ys.learnus.org/a')).rejects.toThrow('멈췄습니다')
    // 날짜면 그 시각까지 (초 단위라 밀리초를 버린다), 아니면 받은 때부터 ms
    const end = date ? Date.parse(header) : t0 + ms
    const clock = vi.spyOn(Date, 'now')
    try {
      clock.mockReturnValue(end - 2000)
      await expect(c.get('https://ys.learnus.org/b')).rejects.toThrow('멈췄습니다')
      clock.mockReturnValue(end + 2000)
      await c.get('https://ys.learnus.org/b')
    } finally {
      clock.mockRestore()
    }
    expect(calls).toHaveLength(2)
  })

  it('도구 호출 하나는 요청 40개까지만 보낸다', async () => {
    vi.doMock('node:timers/promises', () => ({ setTimeout: async () => {} }))
    try {
      const mod = await load()
      const fetch = vi.fn(async () => html(LOGGED_IN))
      vi.stubGlobal('fetch', fetch)
      const c = new mod.Client(async () => sessionJar()).withSignal()
      for (let i = 0; i < 40; i++) await c.get(`https://ys.learnus.org/p${i}`)
      await expect(c.get('https://ys.learnus.org/p40')).rejects.toThrow('40개 초과')
      expect(fetch).toHaveBeenCalledTimes(40)
      // 다음 도구 호출(새 클라이언트)은 다시 보낼 수 있다
      await c.withSignal().get('https://ys.learnus.org/p41')
      expect(fetch).toHaveBeenCalledTimes(41)
    } finally {
      vi.doUnmock('node:timers/promises')
    }
  })

  it('예상과 다른 200 화면(점검·JSON 등)은 캐시하지 않고 오류', async () => {
    const { c, calls } = await setup([
      html('<html><body>시스템 점검 중입니다</body></html>'),
      html('{"error":"maintenance"}'),
      html(LOGGED_IN),
    ])
    for (let i = 0; i < 2; i++) {
      await expect(c.get('https://ys.learnus.org/my/')).rejects.toThrow('예상과 다른 화면')
    }
    expect((await c.get('https://ys.learnus.org/my/')).text).toContain('M.cfg')
    expect(calls).toHaveLength(3)
  }, 10_000)

  it('크기 표시가 없어도 받으면서 세다 200MB를 넘으면 멈춘다', async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024)
    let pulls = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull: (ctl) => void (pulls++, ctl.enqueue(chunk)),
      cancel: () => void (cancelled = true),
    })
    const { c, calls } = await setup([
      new Response(body, { headers: { 'content-type': 'application/pdf' } }),
    ])
    await expect(c.getFile('https://ys.learnus.org/pluginfile.php/1/a/b/x.pdf')).rejects.toThrow(
      '너무 큽니다',
    )
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(30) // 200MB / 8MB = 25쪽 + 앞당겨 읽은 몇 쪽
    expect(calls).toHaveLength(1) // 다시 받지 않는다
  })

  it('파일 받기와 시간 초과는 다시 보내지 않는다 (페이지 연결 오류만 1회)', async () => {
    const file = await setup([new TypeError('fetch failed')])
    await expect(
      file.c.getFile('https://ys.learnus.org/pluginfile.php/1/a/b/x.pdf'),
    ).rejects.toThrow('연결하지 못했습니다')
    expect(file.calls).toHaveLength(1)

    const slow = await setup([new DOMException('timeout', 'TimeoutError')])
    await expect(slow.c.get('https://ys.learnus.org/my/')).rejects.toThrow('시간 초과')
    expect(slow.calls).toHaveLength(1)

    const slowFile = await setup([html(LOGGED_IN), new DOMException('timeout', 'TimeoutError')])
    await slowFile.c.get('https://ys.learnus.org/my/') // 로그인된 세션
    await expect(
      slowFile.c.getFile('https://ys.learnus.org/pluginfile.php/1/a.pdf'),
    ).rejects.toThrow('2분 초과')

    const flaky = await setup([new TypeError('fetch failed'), html(LOGGED_IN)])
    await expect(flaky.c.get('https://ys.learnus.org/my/')).resolves.toBeDefined()
    expect(flaky.calls).toHaveLength(2)
  }, 10_000)

  it('취소된 도구 호출은 로그인도 요청도 보내지 않는다', async () => {
    const { c, calls, login } = await setup([html(LOGGED_IN)])
    const ac = new AbortController()
    ac.abort()
    const t = c.withSignal(ac.signal)
    await expect(t.get('https://ys.learnus.org/my/')).rejects.toThrow('요청이 취소되었습니다')
    await expect(t.getFile('https://ys.learnus.org/pluginfile.php/1/a/b/x.pdf')).rejects.toThrow(
      '요청이 취소되었습니다',
    )
    expect(calls).toHaveLength(0)
    expect(login).not.toHaveBeenCalled()
  })

  it('취소하면 진행 중·대기 중 요청이 멈추고, 같은 세션(로그인·캐시)을 함께 쓴다', async () => {
    const mod = await load()
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, init: RequestInit) => {
        calls.push(String(url))
        if (!String(url).endsWith('/slow')) return html(LOGGED_IN)
        // 응답이 오지 않는 요청: 취소 신호가 와야 끝난다
        return new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
        )
      }),
    )
    const login = vi.fn(async () => sessionJar())
    const c = new mod.Client(login)
    await c.get('https://ys.learnus.org/a')

    const ac = new AbortController()
    const t = c.withSignal(ac.signal)
    const slow = t.get('https://ys.learnus.org/slow')
    const queued = t.get('https://ys.learnus.org/b')
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5000 })
    ac.abort()
    await expect(slow).rejects.toThrow('요청이 취소되었습니다')
    await expect(queued).rejects.toThrow('요청이 취소되었습니다')
    expect(calls).toEqual(['https://ys.learnus.org/a', 'https://ys.learnus.org/slow'])

    // 같은 세션: 다른 도구 호출은 다시 로그인하지 않고 캐시를 그대로 쓴다
    await c.withSignal(new AbortController().signal).get('https://ys.learnus.org/a')
    expect(calls).toHaveLength(2)
    expect(login).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('오류 메시지에 주소의 쿼리(sesskey 등)를 담지 않는다', async () => {
    const { c } = await setup([html('boom', { status: 500 })])
    const err = await c.get('https://ys.learnus.org/x?sesskey=FAKE_SESS_KEY').catch((e: Error) => e)
    expect(String(err)).not.toContain('FAKE_SESS_KEY')

    const net = await setup([])
    const err2 = await net.c
      .get('https://ys.learnus.org/y?sesskey=FAKE_SESS_KEY')
      .catch((e: Error) => e)
    expect(String(err2)).toContain('연결하지 못했습니다')
    expect(String(err2)).not.toContain('FAKE_SESS_KEY')
  }, 10_000)
})

describe('설정', async () => {
  const { env } = await import('../src/config.ts')
  it('.mcpb에서 비워 둔 "${user_config.x}"는 없는 값으로 본다', () => {
    process.env.LEARNUS_TEST_X = '${user_config.download_dir}'
    expect(env('LEARNUS_TEST_X')).toBeUndefined()
    process.env.LEARNUS_TEST_X = ' 2026 '
    expect(env('LEARNUS_TEST_X')).toBe('2026')
    delete process.env.LEARNUS_TEST_X
  })
})

describe('check-secrets', () => {
  const rules = (t: string) => scan(t).map((h) => h.rule)
  it('학번·이메일·sesskey·쿠키·토큰·비밀번호를 잡는다', () => {
    expect(rules('id = 2021123456')).toEqual(['학번 형태 숫자']) // check-secrets: allow
    expect(rules('/files/2021123456_홍길동.pdf')).toEqual(['학번 형태 숫자']) // check-secrets: allow
    expect(rules('mail me: someone@gmail.com')).toEqual(['이메일 주소']) // check-secrets: allow
    expect(rules('"sesskey":"AbCdEf1234"')).toEqual(['sesskey 값']) // check-secrets: allow
    expect(rules('<input name="sesskey" value="AbCdEf1234">')).toEqual(['sesskey 값']) // check-secrets: allow
    expect(rules('MoodleSession=abcdef0123456789abcd')).toEqual(['Moodle 세션 쿠키']) // check-secrets: allow
    expect(rules('export_execute.php?authtoken=0123456789abcdef0123')).toEqual(['iCal 토큰']) // check-secrets: allow
    expect(rules('"LEARNUS_PASSWORD": "Hunter2Real!"')).toEqual(['비밀번호 대입']) // check-secrets: allow
    expect(rules('password = "Hunter2Real!"')).toEqual(['비밀번호 대입']) // check-secrets: allow
  })
  it('공개 주소·허용 표시·평범한 코드는 통과', () => {
    expect(scan('문의: LearnUs@yonsei.ac.kr, noreply@anthropic.com, a@example.com')).toEqual([])
    expect(scan('npm i @modelcontextprotocol/sdk@1.32.1 typescript@6.0.3')).toEqual([])
    expect(scan('const timeoutMs = 15000; // 2026-10-10')).toEqual([])
    expect(scan('2021123456 check-secrets: allow')).toEqual([])
    expect(scan('"password": "${user_config.password}"')).toEqual([])
    expect(scan('const password: string = await ask()')).toEqual([])
    expect(scan("throw new E(m ? 'WRONG_PASSWORD' : 'LAYOUT_CHANGED')")).toEqual([])
  })
})
