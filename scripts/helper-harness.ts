// 금고 헬퍼를 LearnUs 서버처럼 부르는 시험용 대역 (check-native·smoke-package).
// 헬퍼는 부모가 `node <헬퍼 위 폴더>/index.cjs <mode>`일 때만 응답하므로,
// 폴더에 헬퍼 사본과 대역 index.cjs를 두고 그 index.cjs를 <mode>로 실행한다.
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const STAND_IN = `// 시험용 대역: 헬퍼를 서버처럼 부르고 종료 코드와 출력만 돌려준다
const { spawnSync } = require('node:child_process')
const name = process.platform === 'win32' ? 'learnus-credentials.exe' : 'learnus-credentials'
// 잠금 시험이 헬퍼를 부르기 직전 시점을 알 수 있게
if (process.env.HELPER_STARTED) require('node:fs').writeFileSync(process.env.HELPER_STARTED, '')
const r = spawnSync(require('node:path').join(__dirname, 'native', name), [process.env.HELPER_OPERATION], {
  input: process.env.HELPER_INPUT || '',
  encoding: 'utf8',
  timeout: 10000,
  windowsHide: true,
})
process.stdout.write(JSON.stringify({ status: r.status, stdout: r.stdout }))
`

export function helperHarness(helper: string, folder: string) {
  const copy = join(folder, 'native', basename(helper))
  mkdirSync(join(folder, 'native'), { recursive: true })
  copyFileSync(helper, copy)
  if (process.platform !== 'win32') chmodSync(copy, 0o755)
  writeFileSync(join(folder, 'index.cjs'), STAND_IN)
  return (mode: string, operation: string, input = '') => {
    const r = spawnSync(process.execPath, [join(folder, 'index.cjs'), mode], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, HELPER_OPERATION: operation, HELPER_INPUT: input },
    })
    try {
      return JSON.parse(r.stdout) as { status: number | null; stdout: string }
    } catch {
      throw new Error(`헬퍼 대역 실행 실패 (${mode} ${operation})`)
    }
  }
}
