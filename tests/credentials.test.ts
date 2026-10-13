import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

// OS 금고를 열지 않고 실제 파이프·종료 이벤트 경계만 대체한다.
function childResponse(output: string, code = 0, hang = false) {
  let input = ''
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new Writable({
      write(chunk, _, done) {
        input += chunk.toString()
        done()
      },
    }),
    kill: vi.fn(),
  })
  child.stdin.on('finish', () => {
    if (!hang)
      queueMicrotask(() => {
        child.stdout.end(output)
        child.emit('close', code)
      })
  })
  spawn.mockReturnValue(child)
  return { child, input: () => input }
}

beforeEach(() => {
  vi.resetModules()
  spawn.mockReset()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('OS 금고 경계', () => {
  it('설치 폴더 이름이 src여도 번들 옆의 헬퍼를 실행한다', async () => {
    const built = buildSync({
      entryPoints: ['src/credentials.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false,
      define: { 'import.meta.dirname': '__dirname', 'import.meta.filename': '__filename' },
    }).outputFiles[0].text
    const install = resolve('synthetic-install', 'src')
    const exports: { readCredentials?: () => Promise<unknown> } = {}
    const module = { exports }
    const actualRequire = createRequire(import.meta.url)
    runInNewContext(built, {
      module,
      exports,
      __dirname: install,
      __filename: join(install, 'index.cjs'),
      process,
      Buffer,
      setTimeout,
      clearTimeout,
      require: (name: string) => (name === 'node:child_process' ? { spawn } : actualRequire(name)),
    })
    childResponse('{"status":"missing"}')
    await module.exports.readCredentials!()
    expect(spawn.mock.calls[0][0]).toBe(join(install, 'native', 'learnus-credentials'))
  })
  it('비밀번호의 공백·따옴표·유니코드를 보존하고 argv·env로 보내지 않는다', async () => {
    const { writeCredentials } = await import('../src/credentials.ts')
    const value = { username: 'synthetic-user', password: '  test-"é-🔑  ' } // check-secrets: allow
    const stub = childResponse('{"status":"ok"}')
    await writeCredentials(value)
    expect(JSON.parse(stub.input())).toEqual(value)
    const [command, args, options] = spawn.mock.calls[0]
    expect(command).toMatch(/native[/\\]learnus-credentials$/)
    expect(args).toEqual(['write'])
    expect(options.shell).toBe(false)
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore'])
    expect(JSON.stringify(spawn.mock.calls)).not.toContain('synthetic-user')
    expect(JSON.stringify(options.env)).not.toContain('LEARNUS_PASSWORD')
  })

  it('없음과 접근 거절을 구분하고 외부 오류 원문을 숨긴다', async () => {
    const { readCredentials } = await import('../src/credentials.ts')
    childResponse('{"status":"missing"}')
    expect(await readCredentials()).toBeUndefined()
    childResponse('synthetic-private-marker', 1)
    await expect(readCredentials()).rejects.toThrow('OS 금고')
    childResponse('{"status":"error","detail":"synthetic-private-marker"}')
    await expect(readCredentials()).rejects.not.toThrow('synthetic-private-marker')
  })

  it('읽은 값은 파이프 안에서만 반환하고 비밀번호를 그대로 쓴다', async () => {
    const { readCredentials } = await import('../src/credentials.ts')
    const value = { username: 'synthetic-user', password: '  fake-é  ' } // check-secrets: allow
    childResponse(JSON.stringify({ status: 'ok', credentials: value }))
    expect(await readCredentials()).toEqual(value)
  })

  it('실패 표시를 읽고, 남길 때는 값과 실패 종류만 파이프로 보낸다', async () => {
    const { readCredentials, rejectCredentials } = await import('../src/credentials.ts')
    const value = { username: 'synthetic-user', password: 'fake-value' } // check-secrets: allow
    childResponse(JSON.stringify({ status: 'ok', credentials: { ...value, rejected: 'CAPTCHA' } }))
    expect(await readCredentials()).toEqual({ ...value, rejected: 'CAPTCHA' })
    const stub = childResponse('{"status":"ok"}')
    await rejectCredentials(value, 'WRONG_PASSWORD')
    expect(JSON.parse(stub.input())).toEqual({ ...value, code: 'WRONG_PASSWORD' })
    expect(spawn.mock.calls[spawn.mock.calls.length - 1][1]).toEqual(['reject'])
    // 그사이 사용자가 새 값을 저장했으면 헬퍼가 stale을 돌려주고 조용히 넘어간다
    childResponse('{"status":"stale"}')
    await expect(rejectCredentials(value, 'WRONG_PASSWORD')).resolves.toBeUndefined()
  })

  it.each([
    'null',
    '{}',
    '{"status":"ok","credentials":{"username":"u","password":"p","rejected":"lower"}}',
    '{"status":"stale"}',
    '{"status":"ok","credentials":{}}',
    '{"status":"ok","credentials":{"username":1}}',
  ])('잘못된 응답 %s를 거절', async (output) => {
    const { readCredentials } = await import('../src/credentials.ts')
    childResponse(output)
    await expect(readCredentials()).rejects.toThrow('OS 금고')
  })

  it('빈 값·너무 큰 입력을 OS 호출 전에 거절한다', async () => {
    const { writeCredentials } = await import('../src/credentials.ts')
    for (const value of [
      { username: '', password: 'fake' }, // check-secrets: allow
      { username: 'fake', password: '' },
      { username: 'fake', password: 'x'.repeat(2600) },
    ])
      await expect(writeCredentials(value)).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('과대 출력과 30초 대기를 중단한다', async () => {
    const { readCredentials } = await import('../src/credentials.ts')
    const large = childResponse('x'.repeat(8193))
    await expect(readCredentials()).rejects.toThrow('OS 금고')
    expect(large.child.kill).toHaveBeenCalled()
    vi.useFakeTimers()
    const hanging = childResponse('', 0, true)
    const pending = expect(readCredentials()).rejects.toThrow('OS 금고')
    await vi.advanceTimersByTimeAsync(30_000)
    await pending
    expect(hanging.child.kill).toHaveBeenCalled()
  })

  it('실행 실패에 담긴 오류 원문을 숨긴다', async () => {
    const { readCredentials } = await import('../src/credentials.ts')
    spawn.mockImplementation(() => {
      throw new Error('synthetic-private-marker')
    })
    await expect(readCredentials()).rejects.not.toThrow('synthetic-private-marker')
  })

  it('없는 항목 삭제는 성공이고 Linux에서는 실행하지 않는다', async () => {
    const { deleteCredentials } = await import('../src/credentials.ts')
    childResponse('{"status":"missing"}')
    await expect(deleteCredentials()).resolves.toBeUndefined()
    spawn.mockClear()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(deleteCredentials()).rejects.toThrow('macOS')
    expect(spawn).not.toHaveBeenCalled()
  })
})
