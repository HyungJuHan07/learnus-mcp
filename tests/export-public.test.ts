import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { exportPublic, publicAgents } from '../scripts/export-public.ts'

const PUBLIC = 'https://github.com/HyungJuHan07/learnus-mcp.git'
const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'learnus-export-'))
  made.push(dir)
  return dir
}
const AGENTS = '## 범위\n\n## 절대 원칙\n\n## 금지\n'
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  })
const gitIn = (cwd: string, input: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, input }).toString().trim()
function repo(origin?: string, files: Record<string, string> = {}) {
  const dir = temp()
  git(dir, 'init', '-q')
  if (origin) git(dir, 'remote', 'add', 'origin', origin)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  if (Object.keys(files).length) {
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'init')
  }
  return dir
}

// 윈도우는 git 프로세스를 띄우는 데 오래 걸린다 (CI에서 10초 넘게 걸린 적이 있다)
describe('공개 저장소 내보내기', { timeout: 60_000 }, () => {
  it('docs/와 개발 규칙을 빼고 설치 안내·범위·절대 원칙·금지만 남긴다', () => {
    const target = repo(PUBLIC, { 'stale.txt': '지난 버전에만 있던 파일' })
    const files = exportPublic(target)
    expect(files).toContain('src/server.ts')
    expect(files.some((f) => f.startsWith('docs/'))).toBe(false)
    expect(existsSync(join(target, 'stale.txt'))).toBe(false)
    expect(existsSync(join(target, '.git'))).toBe(true)
    const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('INSTALL_CHATGPT.md')
    for (const kept of ['## 범위', '## 절대 원칙', '## 금지']) expect(agents).toContain(kept)
    for (const dropped of ['## 확인된 사실', '## 코드 규칙', '## 브랜치·커밋·배포'])
      expect(agents).not.toContain(dropped)
  })

  it('이미 내보낸 AGENTS.md를 다시 넣어도 같은 결과가 나온다', () => {
    const once = publicAgents(readFileSync('AGENTS.md', 'utf8'))
    expect(publicAgents(once)).toBe(once)
  })

  it('공개 저장소 clone이 아니면 아무것도 지우지 않고 멈춘다', () => {
    // 이름을 바꾸기 전의 개발 저장소는 origin이 공개 주소와 같다
    const dev = repo(PUBLIC, {
      'AGENTS.md': '## 범위\n\n## 절대 원칙\n\n## 금지\n',
      'docs/DESIGN.md': '개발 저장소 전용',
    })
    writeFileSync(join(dev, 'work.txt'), '커밋하지 않은 작업')
    const alias = join(temp(), 'alias')
    symlinkSync(dev, alias, 'junction')
    const worktree = join(temp(), 'worktree')
    git(dev, 'worktree', 'add', '-q', worktree)
    const other = repo('https://github.com/someone/else.git', { 'keep.txt': '남의 저장소' })
    const dirty = repo(PUBLIC, { 'keep.txt': '공개 clone' })
    writeFileSync(join(dirty, 'draft.txt'), '커밋하지 않은 변경')
    const nested = join(repo(PUBLIC, { 'keep.txt': '공개 clone' }), 'sub')
    mkdirSync(nested)
    writeFileSync(join(nested, 'keep.txt'), '하위 폴더')
    const plain = temp()
    writeFileSync(join(plain, 'keep.txt'), 'git 저장소가 아님')
    // 새 공개 저장소를 만들기 전에 옛 주소로 받으면 개발 저장소의 clone이 된다
    writeFileSync(join(dev, 'second.txt'), '두 번째 커밋')
    git(dev, 'add', 'second.txt')
    git(dev, 'commit', '-qm', 'second')
    const devClone = join(temp(), 'clone')
    git(temp(), 'clone', '-q', dev, devClone)
    git(devClone, 'remote', 'set-url', 'origin', PUBLIC)
    const shallow = join(temp(), 'shallow')
    git(temp(), 'clone', '-q', '--depth', '1', pathToFileURL(dev).href, shallow)
    git(shallow, 'remote', 'set-url', 'origin', PUBLIC)

    const targets = [
      dev,
      alias,
      worktree,
      other,
      dirty,
      nested,
      plain,
      join(plain, 'none'),
      devClone,
      shallow,
    ]
    for (const target of targets) expect(() => exportPublic(target, dev)).toThrow()

    expect(readFileSync(join(dev, 'work.txt'), 'utf8')).toBe('커밋하지 않은 작업')
    expect(existsSync(join(dev, 'docs/DESIGN.md'))).toBe(true)
    expect(existsSync(join(worktree, 'docs/DESIGN.md'))).toBe(true)
    for (const dir of [other, dirty, nested, plain])
      expect(existsSync(join(dir, 'keep.txt'))).toBe(true)
    expect(existsSync(join(dirty, 'draft.txt'))).toBe(true)
    expect(existsSync(join(devClone, 'docs/DESIGN.md'))).toBe(true)
    expect(existsSync(join(shallow, 'docs/DESIGN.md'))).toBe(true)
  })

  it('개발 저장소 HEAD에 대상 밖이나 .git을 가리키는 경로가 있으면 아무것도 지우지 않는다', () => {
    const target = repo(PUBLIC, { 'keep.txt': '공개 clone' })
    // git은 이런 경로를 checkout하지 않지만, 트리를 직접 만들면 HEAD에 넣을 수 있다
    for (const unsafe of ['.GIT/config', 'a/../../escaped.txt']) {
      const src = repo(PUBLIC, { 'AGENTS.md': AGENTS })
      const blob = gitIn(src, 'x', 'hash-object', '-w', '--stdin')
      const names = unsafe.split('/')
      let entry = `100644 blob ${blob}\t${names.at(-1)}`
      for (const name of names.slice(0, -1).reverse())
        entry = `040000 tree ${gitIn(src, `${entry}\n`, 'mktree')}\t${name}`
      const tree = gitIn(src, `${git(src, 'ls-tree', 'HEAD')}${entry}\n`, 'mktree')
      git(src, 'update-ref', 'HEAD', git(src, 'commit-tree', tree, '-m', 'x').toString().trim())
      expect(() => exportPublic(target, src)).toThrow('내보낼 수 없는 경로')
    }
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('공개 clone')
  })

  // 윈도우는 파일 이름에 "를 쓸 수 없다
  it.skipIf(process.platform === 'win32')(
    '이름이 따옴표로 시작하는 파일의 수정도 지우지 않는다',
    () => {
      // hash-object --stdin-paths는 "a"를 a로 읽어, 내용이 같은 다른 파일을 해시할 수 있다
      const dev = repo(PUBLIC, { 'AGENTS.md': AGENTS })
      const target = repo(PUBLIC, { a: '같은 내용', '"a"': '같은 내용' })
      writeFileSync(join(target, '"a"'), '커밋하지 않은 수정')
      expect(() => exportPublic(target, dev)).toThrow()
      expect(readFileSync(join(target, '"a"'), 'utf8')).toBe('커밋하지 않은 수정')
    },
  )

  it('git status에서 숨겨지는 파일·변경이 있어도 아무것도 지우지 않고 멈춘다', () => {
    const dev = repo(PUBLIC, { 'AGENTS.md': AGENTS })
    const hidden = repo(PUBLIC, { 'a.txt': '커밋' })
    git(hidden, 'config', 'status.showUntrackedFiles', 'no')
    writeFileSync(join(hidden, 'keep.txt'), '숨겨진 미추적 파일')
    const ignored = repo(PUBLIC, { '.gitignore': 'keep.txt\n' })
    writeFileSync(join(ignored, 'keep.txt'), '무시된 파일')
    const assumed = repo(PUBLIC, { 'keep.txt': '커밋한 내용' })
    writeFileSync(join(assumed, 'keep.txt'), '고친 내용')
    git(assumed, 'update-index', '--assume-unchanged', 'keep.txt')
    // ident 속성은 $Id: ... $ 안을 지운 뒤 해시해, 고친 내용도 커밋과 같아 보인다
    const filtered = repo(PUBLIC, { 'keep.txt': '$Id$\n' })
    writeFileSync(join(filtered, '.git', 'info', 'attributes'), 'keep.txt ident\n')
    writeFileSync(join(filtered, 'keep.txt'), '$Id: 저장 안 한 메모 $\n')
    const staged = repo(PUBLIC, { 'a.txt': '커밋' })
    writeFileSync(join(staged, 'keep.txt'), '스테이지에만')
    git(staged, 'add', 'keep.txt')
    rmSync(join(staged, 'keep.txt'))

    for (const target of [hidden, ignored, assumed, filtered, staged])
      expect(() => exportPublic(target, dev)).toThrow()

    expect(readFileSync(join(hidden, 'keep.txt'), 'utf8')).toBe('숨겨진 미추적 파일')
    expect(readFileSync(join(ignored, 'keep.txt'), 'utf8')).toBe('무시된 파일')
    expect(readFileSync(join(assumed, 'keep.txt'), 'utf8')).toBe('고친 내용')
    expect(readFileSync(join(filtered, 'keep.txt'), 'utf8')).toBe('$Id: 저장 안 한 메모 $\n')
    expect(git(staged, 'show', ':keep.txt').toString()).toBe('스테이지에만')
  })
})
