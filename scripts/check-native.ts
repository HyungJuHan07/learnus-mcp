// 컴파일된 헬퍼의 거절 경로만 검사한다. 금고 항목·학교 서버를 열지 않는다.
// dist/native에 옛 헬퍼(호출자 확인 전)가 남아 있어도 개발자 컴퓨터의 실제 항목에 닿지 않게,
// 어느 버전이든 금고를 열기 전에 거절하는 입력만 보낸다 (읽기·삭제·올바른 저장은 CI 스모크에서).

import { spawnSync } from 'node:child_process'
import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { helperHarness } from './helper-harness.ts'

const helper = resolve(
  'dist/native',
  `learnus-credentials${process.platform === 'win32' ? '.exe' : ''}`,
)
const refused = (status: number | null, stdout: string) =>
  status === 1 && stdout === '{"status":"error"}'

// 터미널·다른 프로그램에서 바로 부르면 거절한다
for (const [operation, input] of [
  ['unknown', ''],
  ['write', '{'],
  ['write', '{}'],
  ['reject', '{'],
]) {
  const r = spawnSync(helper, [operation], { input, encoding: 'utf8', timeout: 5000 })
  // 오류 원문은 출력하지 않는다. 어떤 단계에서 실패했는지만 남긴다.
  assert.ok(refused(r.status, r.stdout), `직접 실행한 ${operation}을 거절해야 합니다`)
  assert.equal(r.stderr, '', '헬퍼 stderr는 비어 있어야 합니다.')
}

// 서버처럼 불러도 입력이 잘못되면 금고를 열기 전에 거절한다
const folder = mkdtempSync(join(tmpdir(), 'learnus-helper-'))
try {
  const call = helperHarness(helper, folder)
  for (const [mode, operation, input] of [
    ['chatgpt', 'unknown', ''],
    ['credentials-set', 'write', '{'],
    ['credentials-set', 'write', '{}'],
    ['credentials-set', 'write', 'x'.repeat(2561)],
    ['credentials-set', 'write', '{"username":"a","password":"b","extra":"c"}'],
    ['chatgpt', 'reject', '{"username":"a","password":"b"}'],
    ['chatgpt', 'reject', '{"username":"a","password":"b","code":"lower"}'],
    ['chatgpt', 'reject', '{"username":"a","password":"b","code":"WRONG\\n"}'],
  ]) {
    const r = call(mode, operation, input)
    assert.ok(refused(r.status, r.stdout), `${mode} ${operation}: 잘못된 호출을 거절해야 합니다`)
  }
} finally {
  rmSync(folder, { recursive: true, force: true })
}
console.log('금고 접근 없는 네이티브 거절 검증 통과')
