import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  answers: [] as (string | null)[],
  write: vi.fn(),
  remove: vi.fn(),
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
