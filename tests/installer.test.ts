import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
// 첫 import(변환·로드)가 첫 시험의 5초 제한에 들어가 윈도우 CI에서 시간 초과가 났다 → 모듈 수집 때 한 번 불러온다
import { install, supportedNode, withTimeouts } from '../scripts/install-chatgpt.ts'

const run = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFileSync: run }))
const roots: string[] = []
function missing() {
  throw Object.assign(new Error(), {
    status: 1,
    stderr: "Error: No MCP server named 'learnus' found.\n",
  })
}
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  run.mockReset()
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'learnus 설치 '))
  roots.push(root)
  const source = join(root, 'package')
  mkdirSync(source)
  for (const file of [
    'index.cjs',
    process.platform === 'win32' ? 'native/learnus-credentials.exe' : 'native/learnus-credentials',
    'cmaps/LICENSE',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'INSTALL_CHATGPT.md',
  ]) {
    mkdirSync(join(source, file, '..'), { recursive: true })
    writeFileSync(join(source, file), 'synthetic')
  }
  return {
    source,
    destination: join(root, 'installed'),
    codex: 'codex',
    configFile: join(root, 'config.toml'),
    node: process.execPath,
  }
}
it('설치하고 기존 다른 설정을 건드리지 않는 공식 등록 명령만 실행한다', async () => {
  const options = fixture()
  run
    .mockImplementationOnce(missing)
    .mockImplementationOnce(() => {
      writeFileSync(options.configFile, '[mcp_servers.learnus]\ncommand = "node"\n')
      return ''
    })
    .mockReturnValue('{"tool_timeout_sec":180}')
  const { destination: result, backup } = install(options)
  expect(readFileSync(join(result, 'index.cjs'), 'utf8')).toBe('synthetic')
  // 설정 파일이 없던 컴퓨터에서는 백업할 것이 없다
  expect(backup).toBeUndefined()
  expect(run.mock.calls[1][1]).toEqual([
    'mcp',
    'add',
    'learnus',
    '--',
    process.execPath,
    join(result, 'index.cjs'),
    'chatgpt',
  ])
  expect(JSON.stringify(run.mock.calls)).not.toMatch(/credentials|LEARNUS_PASSWORD/)
})
it('기존 learnus 등록은 덮어쓰지 않는다', async () => {
  const options = fixture()
  run.mockReturnValue(JSON.stringify([{ name: 'learnus' }]))
  expect(() => install(options)).toThrow('이미 등록')
  expect(existsSync(options.destination)).toBe(false)
  expect(run).toHaveBeenCalledTimes(1)
})
it('파일 누락·심볼릭 링크는 등록 전에 거절한다', async () => {
  const options = fixture()
  rmSync(join(options.source, 'index.cjs'))
  expect(() => install(options)).toThrow()
  expect(run).not.toHaveBeenCalled()
  symlinkSync(join(options.source, 'LICENSE'), join(options.source, 'index.cjs'))
  expect(() => install(options)).toThrow()
  expect(run).not.toHaveBeenCalled()
})
it('등록 실패 때 외부 오류를 노출하지 않고 설치 파일은 남겨 재시도를 안내한다', async () => {
  const options = fixture()
  run.mockImplementationOnce(missing).mockImplementationOnce(() => {
    throw new Error('synthetic-private-marker')
  })
  expect(() => install(options)).toThrow('등록하지 못')
  expect(existsSync(join(options.destination, 'index.cjs'))).toBe(true)
})
it('기존 설치 폴더를 덮어쓰지 않는다', async () => {
  const options = fixture()
  mkdirSync(options.destination)
  writeFileSync(join(options.destination, 'index.cjs'), 'keep')
  run.mockImplementationOnce(missing)
  expect(() => install(options)).toThrow()
  expect(readFileSync(join(options.destination, 'index.cjs'), 'utf8')).toBe('keep')
})
it('공식 CLI가 생성한 단일 섹션에만 제한 시간을 추가한다', async () => {
  const original =
    '# keep\n[other]\nvalue = "keep"\n[mcp_servers.learnus]\ncommand = "node"\nargs = ["index.cjs", "chatgpt"]\n'
  const changed = withTimeouts(original)
  expect(changed).toContain('tool_timeout_sec = 180')
  expect(changed).toContain('startup_timeout_sec = 30')
  expect(changed.replace('startup_timeout_sec = 30\ntool_timeout_sec = 180\n', '')).toBe(original)
  expect(() => withTimeouts(original + '[mcp_servers.learnus]\n')).toThrow()
  expect(() => withTimeouts('[unrelated]\n')).toThrow()
})
it('Windows npm CLI는 cmd 셸 없이 Node로 실행한다', async () => {
  const options = fixture()
  options.codex = join(options.source, 'codex.js')
  run
    .mockImplementationOnce(missing)
    .mockImplementationOnce(() => {
      writeFileSync(options.configFile, '[mcp_servers.learnus]\ncommand = "node"\n')
      return ''
    })
    .mockReturnValue('{"tool_timeout_sec":180}')
  install(options)
  expect(run.mock.calls[0][0]).toBe(process.execPath)
  expect(run.mock.calls[0][1]).toEqual([options.codex, 'mcp', 'get', 'learnus', '--json'])
  expect(run.mock.calls[1][1]).toEqual([
    options.codex,
    'mcp',
    'add',
    'learnus',
    '--',
    process.execPath,
    join(options.destination, 'index.cjs'),
    'chatgpt',
  ])
})

it('바꾸기 전 Codex 설정을 본인만 읽는 백업으로 남긴다', async () => {
  const options = fixture()
  const original = '# 내 주석\n[mcp_servers.other]\ncommand = "x"\n'
  writeFileSync(options.configFile, original)
  run
    .mockImplementationOnce(missing)
    .mockImplementationOnce(() => {
      writeFileSync(options.configFile, '[mcp_servers.learnus]\ncommand = "node"\n')
      return ''
    })
    .mockReturnValue('{"tool_timeout_sec":180}')
  const { backup } = install(options)
  expect(readFileSync(backup!, 'utf8')).toBe(original)
  if (process.platform !== 'win32') expect(statSync(backup!).mode & 0o777).toBe(0o600)
})

it('Node 22.18 미만은 MCP 실행 명령으로 등록하지 않는다', async () => {
  expect(supportedNode('20.11.1')).toBe(false)
  expect(supportedNode('22.17.1')).toBe(false)
  expect(supportedNode('22.18.0')).toBe(true)
  expect(supportedNode('24.0.0')).toBe(true)
})

it.skipIf(process.platform === 'win32')(
  'Homebrew 버전 폴더의 node 대신 PATH의 안정된 이름을 등록한다',
  async () => {
    const { stableNodePath } = await import('../src/node-path.ts')
    const root = mkdtempSync(join(tmpdir(), 'learnus-node-'))
    roots.push(root)
    const cellar = join(root, 'Cellar', 'node', '24.1.0', 'bin', 'node')
    mkdirSync(join(cellar, '..'), { recursive: true })
    writeFileSync(cellar, '')
    mkdirSync(join(root, 'bin'))
    symlinkSync(cellar, join(root, 'bin', 'node'))
    const path = ['relative', join(root, 'empty'), join(root, 'bin')].join(delimiter)
    expect(stableNodePath(cellar, path)).toBe(join(root, 'bin', 'node'))
    // PATH에 같은 파일이 없으면 그대로 쓴다
    expect(stableNodePath(cellar, join(root, 'empty'))).toBe(cellar)
  },
)
