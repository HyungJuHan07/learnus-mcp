// scripts/check-secrets.ts를 임시 git 저장소에서 pre-commit 훅처럼(--staged) 실제로 돌려 본다.
// 이 저장소의 git 설정·색인은 건드리지 않는다 (GIT_* 환경변수를 지우고 임시 폴더에서만 실행).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { scan } from '../scripts/check-secrets.ts'

const SCRIPT = fileURLToPath(new URL('../scripts/check-secrets.ts', import.meta.url))
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function checkStaged(files: Record<string, string | Uint8Array>) {
  const dir = mkdtempSync(join(tmpdir(), 'check-secrets-'))
  temps.push(dir)
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    // core.quotePath 기본값(true)으로 고정: 한글 이름이 "\355\225..."로 바뀌는 환경을 재현
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.quotePath',
    GIT_CONFIG_VALUE_0: 'true',
  }
  execFileSync('git', ['init', '-q'], { cwd: dir, env })
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir, env })
  const r = spawnSync(process.execPath, [SCRIPT, '--staged'], { cwd: dir, env, encoding: 'utf8' })
  return { code: r.status, err: r.stderr }
}

describe('check-secrets --staged', { timeout: 30_000 }, () => {
  it('한글 이름 파일에서 멈추지 않고 내용을 검사한다', () => {
    expect(checkStaged({ '강의자료/공지.txt': '안녕하세요\n' })).toEqual({ code: 0, err: '' })
    const r = checkStaged({ '강의자료/공지.txt': 'sesskey=AbCdEf1234\n' }) // check-secrets: allow
    expect(r.code).toBe(1)
    expect(r.err).toContain('강의자료/공지.txt:1: sesskey 값')
  })

  it('바이너리 파일은 막고, 허용 경로(packaging/cmaps/)만 통과', () => {
    const bin = new Uint8Array([0x25, 0x50, 0x00, 0x01])
    const r = checkStaged({ 'docs/slide.bin': bin })
    expect(r.code).toBe(1)
    expect(r.err).toContain('docs/slide.bin: 바이너리 파일')
    // NUL이 없어도 강의자료 확장자면 막는다
    expect(checkStaged({ 'notes.pdf': '%PDF-1.4\n' }).code).toBe(1)
    expect(checkStaged({ 'packaging/cmaps/KSC-H.bcmap': bin })).toEqual({ code: 0, err: '' })
  })

  it('파일 이름 속 학번을 막고, 출력에서는 가린다', () => {
    const r = checkStaged({ 'r_2021123456_홍길동.txt': 'ok\n' }) // check-secrets: allow
    expect(r.code).toBe(1)
    expect(r.err).toContain('r_***_홍길동.txt: 파일 이름에 학번 형태 숫자')
    expect(r.err).not.toMatch(/\d{10}/)
  })
})

describe('check-secrets 비밀번호 규칙', () => {
  const rules = (t: string) => scan(t).map((h) => h.rule)
  it('따옴표 없는 env 형식과 공백 든 비밀번호를 잡는다', () => {
    expect(rules('LEARNUS_PASSWORD=Hunter2Real!')).toEqual(['비밀번호 대입']) // check-secrets: allow
    expect(rules('export LEARNUS_PASSWORD = Hunter2Real!')).toEqual(['비밀번호 대입']) // check-secrets: allow
    expect(rules('password: "correct horse battery"')).toEqual(['비밀번호 대입']) // check-secrets: allow
  })
  it('자리표시·코드는 통과', () => {
    expect(scan('LEARNUS_PASSWORD=${user_config.password}')).toEqual([])
    expect(scan('LEARNUS_PASSWORD=$LEARNUS_PASSWORD')).toEqual([])
    expect(scan('const password = env.LEARNUS_PASSWORD')).toEqual([])
    expect(scan("if (env('LEARNUS_PASSWORD') === undefined) throw e")).toEqual([])
  })
})
