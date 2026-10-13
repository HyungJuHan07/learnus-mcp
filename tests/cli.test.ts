import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  answers: [] as (string | null)[],
  write: vi.fn(),
  remove: vi.fn(),
  login: vi.fn(),
  courses: vi.fn(),
  deadlines: vi.fn(),
}))
vi.mock('../src/auth.ts', async (original) => ({
  ...(await original<typeof import('../src/auth.ts')>()),
  login: state.login,
}))
vi.mock('../src/learnus.ts', async (original) => ({
  ...(await original<typeof import('../src/learnus.ts')>()),
  listCourses: state.courses,
  upcomingDeadlines: state.deadlines,
  listAnnouncements: async () => [],
  unwatchedVideos: async () => [],
}))
vi.mock('../src/materials.ts', async (original) => ({
  ...(await original<typeof import('../src/materials.ts')>()),
  listMaterials: async () => [],
}))
vi.mock('../src/credentials.ts', () => ({
  writeCredentials: state.write,
  deleteCredentials: state.remove,
  readCredentials: vi.fn(),
}))
vi.mock('node:readline', () => ({
  createInterface: () => {
    const rl = Object.assign(new EventEmitter(), {
      _writeToOutput: (value: string) => process.stdout.write(value),
      close: () => {
        rl.emit('close')
      },
      question: (_: string, done: (value: string) => void) =>
        queueMicrotask(() => {
          const value = state.answers.shift()
          if (value == null) rl.close()
          else {
            rl._writeToOutput(value)
            done(value)
          }
        }),
    })
    return rl
  },
}))

const inputTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const outputTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
beforeEach(() => {
  state.write.mockReset()
  state.remove.mockReset()
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const [stream, descriptor] of [
    [process.stdin, inputTTY],
    [process.stdout, outputTTY],
  ] as const) {
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor)
    else Reflect.deleteProperty(stream, 'isTTY')
  }
  process.exitCode = 0
})

describe('사람이 직접 하는 금고 설정', () => {
  it('아이디는 보이게(학번 오타 확인), 비밀번호는 숨겨 받고 앞뒤 공백을 보존한다', async () => {
    state.answers = ['synthetic-user', '  synthetic-secret  ', '  synthetic-secret  ']
    const { runCli } = await import('../src/cli.ts')
    await runCli('credentials-set')
    expect(state.write).toHaveBeenCalledWith({
      username: 'synthetic-user',
      password: '  synthetic-secret  ', // check-secrets: allow
    }) // check-secrets: allow
    const shown = JSON.stringify(vi.mocked(process.stdout.write).mock.calls)
    expect(shown).toContain('synthetic-user')
    expect(shown).not.toContain('synthetic-secret')
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(
      /synthetic-user|synthetic-secret/,
    )
  })
  it.each([
    ['fake-user', 'fake-one', 'fake-two'],
    ['fake-user', null],
  ])('불일치·입력 중단은 저장하지 않는다', async (...answers) => {
    state.answers = answers
    const { runCli } = await import('../src/cli.ts')
    await runCli('credentials-set')
    expect(state.write).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
  it('명시적인 yes일 때만 전용 항목 삭제를 요청한다', async () => {
    const { runCli } = await import('../src/cli.ts')
    state.answers = ['no']
    await runCli('credentials-clear')
    expect(state.remove).not.toHaveBeenCalled()
    state.answers = ['yes']
    await runCli('credentials-clear')
    expect(state.remove).toHaveBeenCalledOnce()
  })
  it('저장·삭제 실패에 포함된 외부 원문을 출력하지 않는다', async () => {
    const { runCli } = await import('../src/cli.ts')
    state.answers = ['yes']
    state.remove.mockRejectedValue(new Error('synthetic-private-marker'))
    await runCli('credentials-clear')
    expect(process.exitCode).toBe(1)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      'synthetic-private-marker',
    )
  })
})

describe('check 출력의 제어 문자', () => {
  // 줄 올리기·지우기·CR·LF(가짜 줄)·DEL·C1(CSI·OSC)
  const NASTY = 'A\x1b[1A\x1b[2K\rFAKE\n✔ forged\x7f\x9b2K\x9d0;T\x07'
  // 고정 문구의 줄바꿈(\n)만 허용한다
  // eslint-disable-next-line no-control-regex -- 제어 문자가 나오지 않는지 본다
  const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/
  const printed = () =>
    [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map((a) =>
      a.join(' '),
    )

  it('LearnUs에서 온 강좌 이름·오류 문구의 제어 문자를 \\xNN 글자로 찍는다', async () => {
    state.answers = ['synthetic-user', 'synthetic-pw']
    state.login.mockResolvedValue({})
    state.courses.mockResolvedValue([{ id: '1', name: NASTY }])
    const { LearnUsError } = await import('../src/client.ts')
    state.deadlines.mockRejectedValue(new LearnUsError(`E${NASTY}`))
    const { runCli } = await import('../src/cli.ts')
    await runCli('check')
    const lines = printed()
    const external = lines.filter((l) => l.includes('FAKE'))
    // 강좌 목록 첫 항목, 마감 실패 문구, 과목 공지·강의자료 단계 이름
    expect(external).toHaveLength(4)
    for (const l of lines) expect(l).not.toMatch(CONTROL)
    for (const l of external) {
      expect(l).not.toContain('\n')
      expect(l).toContain('\\x9b2K')
    }
  })

  it('로그인 실패의 포털 안내·거쳐 간 단계도 제어 문자를 찍지 않고, 다시 실행 경고는 남는다', async () => {
    state.answers = ['synthetic-user', 'synthetic-pw']
    const { LoginError } = await import('../src/auth.ts')
    const error = new LoginError('WRONG_PASSWORD', `P${NASTY}`)
    error.trace = ['GET /a', `POST f${NASTY}`]
    state.login.mockRejectedValue(error)
    const { runCli } = await import('../src/cli.ts')
    await runCli('check')
    expect(process.exitCode).toBe(1)
    const lines = printed()
    for (const l of lines) expect(l).not.toMatch(CONTROL)
    expect(lines.filter((l) => l.includes('FAKE') && !l.startsWith('\n거쳐 간 단계'))).toEqual([
      expect.not.stringContaining('\n'),
    ])
    expect(lines.some((l) => l.includes('다시 실행하면 비밀번호가 한 번 더 전송됩니다'))).toBe(true)
    expect(lines.at(-1)).toBe(
      '\n거쳐 간 단계:\n- GET /a\n- POST fA\\x1b[1A\\x1b[2K\\x0dFAKE\\x0a✔ forged\\x7f\\x9b2K\\x9d0;T\\x07',
    )
  })
})
