import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chatgptConfig } from '../src/chatgpt.ts'

describe('ChatGPT 배포물', () => {
  it('공백·한글·역슬래시가 있는 경로를 설정에 보존하고 비밀값을 요구하지 않는다', () => {
    const command = 'C:\\Program Files\\nodejs\\node.exe'
    const entry = 'C:\\Users\\가짜 사용자\\LearnUs\\index.cjs'
    const config = chatgptConfig(command, entry)
    expect(JSON.parse(config.match(/^command = (.*)$/m)![1])).toBe(command)
    expect(JSON.parse(config.match(/^args = (.*)$/m)![1])).toEqual([entry, 'chatgpt'])
    expect(config).not.toMatch(/LEARNUS_PASSWORD|LEARNUS_USERNAME/)
    expect(config).toContain('tool_timeout_sec = 180')
  })
  it.each(['darwin', 'win32'] as const)(
    '%s 설치 폴더에 헬퍼·CMap·라이선스를 포함한다',
    async (platform) => {
      const { stageChatGPT } = await import('../scripts/pack-chatgpt.ts')
      const root = mkdtempSync(join(tmpdir(), 'learnus-package-'))
      try {
        const helper = platform === 'win32' ? 'learnus-credentials.exe' : 'learnus-credentials'
        const files = [
          'dist/index.cjs',
          'dist/install.cjs',
          `dist/native/${helper}`,
          'dist/THIRD_PARTY_NOTICES.txt',
          'packaging/cmaps/LICENSE',
          'packaging/cmaps/test.bcmap',
          'LICENSE',
          'INSTALL_CHATGPT.md',
        ]
        for (const file of files) {
          const path = join(root, file)
          mkdirSync(join(path, '..'), { recursive: true })
          writeFileSync(path, 'synthetic-public-file')
        }
        const destination = join(root, '한글 설치 폴더')
        stageChatGPT(root, destination, platform)
        for (const file of [
          'index.cjs',
          'install.cjs',
          `native/${helper}`,
          'cmaps/test.bcmap',
          'cmaps/LICENSE',
          'LICENSE',
          'THIRD_PARTY_NOTICES.txt',
          'INSTALL_CHATGPT.md',
        ]) {
          expect(readFileSync(join(destination, file), 'utf8')).toBe('synthetic-public-file')
        }
        expect(existsSync(join(destination, '.env'))).toBe(false)
        expect(() => stageChatGPT(root, destination, platform)).toThrow()
        expect(readFileSync(join(destination, 'index.cjs'), 'utf8')).toBe('synthetic-public-file')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

it.skipIf(process.platform !== 'darwin')('만든 압축 항목은 ./로 시작하지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'learnus-archive-'))
  try {
    for (const file of [
      'dist/index.cjs',
      'dist/install.cjs',
      'dist/native/learnus-credentials',
      'dist/THIRD_PARTY_NOTICES.txt',
      'LICENSE',
      'INSTALL_CHATGPT.md',
      'packaging/cmaps/test.bcmap',
    ]) {
      mkdirSync(join(root, file, '..'), { recursive: true })
      writeFileSync(join(root, file), 'synthetic')
    }
    execFileSync(process.execPath, [resolve('scripts/pack-chatgpt.ts')], {
      cwd: root,
      stdio: 'pipe',
    })
    const names = execFileSync(
      '/usr/bin/tar',
      ['-tf', join(root, 'dist/learnus-chatgpt-macos.tar.gz')],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
    expect(names).toContain('index.cjs')
    expect(names).toContain('cmaps/test.bcmap')
    expect(names.some((name) => name.startsWith('./'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
