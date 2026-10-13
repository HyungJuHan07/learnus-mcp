import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { expect, it } from 'vitest'

it('심볼릭 링크 경로로 실행해도 설치 main이 실행된다', () => {
  const root = mkdtempSync(join(tmpdir(), 'learnus-entry-'))
  try {
    const real = join(root, 'real')
    const link = join(root, 'link')
    mkdirSync(real)
    buildSync({
      entryPoints: ['scripts/install-chatgpt.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: join(real, 'install.cjs'),
      define: { 'import.meta.dirname': '__dirname', 'import.meta.filename': '__filename' },
    })
    symlinkSync(real, link, 'junction')
    // 불완전한 배포물이라 main은 안내와 함께 실패해야 한다. 설정·금고에는 닿지 않는다.
    const result = spawnSync(process.execPath, [join(link, 'install.cjs')], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/설치를 완료하지 못했습니다|macOS·Windows에서 실행하세요/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
