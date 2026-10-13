// 공개 저장소(HyungJuHan07/learnus-mcp)에 올릴 파일을 만든다. 이 저장소 HEAD에 커밋된 파일만 쓰고
// (커밋하지 않은 변경은 나가지 않는다), 개발 저장소 전용인 docs/는 빼고, AGENTS.md는 설치 안내와
// 범위·절대 원칙·금지만 남긴다.
// 사용: node scripts/export-public.ts <공개 저장소를 clone한 폴더>  (그 폴더의 .git 말고는 모두 바꾼다)
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRIVATE = ['docs/']
const SECTIONS = ['범위', '절대 원칙', '금지']
const PUBLIC_REMOTE =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)HyungJuHan07\/learnus-mcp(?:\.git)?\/?$/i
const HEADER = `# AGENTS.md — learnus-mcp

> **이 저장소를 설치하려는 AI 에이전트에게:** 빌드하지 말고 Claude는 [\`INSTALL_FOR_AI.md\`](INSTALL_FOR_AI.md), ChatGPT는 [\`INSTALL_CHATGPT.md\`](INSTALL_CHATGPT.md)를 그대로 따르세요. 사용자의 비밀번호를 묻거나 받지 마세요.

비공식(Unofficial) 학생 프로젝트이며 연세대학교와 무관합니다. 아래는 이 도구와 이 저장소에서 일하는 AI가 지키는 범위와 원칙입니다.
`

export function publicAgents(source: string) {
  const parts = source.split(/^(?=## )/m)
  const kept = SECTIONS.map((name) => {
    const part = parts.find((p) => p.startsWith(`## ${name}\n`))
    if (!part) throw new Error(`AGENTS.md에서 '## ${name}' 절을 찾지 못했습니다`)
    return part.trim()
  })
  return `${[HEADER.trim(), ...kept].join('\n\n')}\n`
}

// GIT_DIR 같은 환경변수가 있으면 git이 cwd가 아닌 다른 저장소를 본다
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
const text = (cwd: string, ...args: string[]) =>
  git(cwd, ...args)
    .toString()
    .trim()
const real = (path: string) => realpathSync.native(path)

function topLevel(dir: string, error: string) {
  try {
    return real(text(dir, 'rev-parse', '--show-toplevel'))
  } catch {
    throw new Error(error)
  }
}

/** 지우기 전에 확인한다. 하나라도 어긋나면 아무것도 지우지 않는다. */
function checkTarget(dest: string, src: string) {
  const within = (a: string, b: string) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)
  if (within(dest, src) || within(src, dest))
    throw new Error('개발 저장소와 겹치는 폴더에는 내보내지 않습니다')
  if (topLevel(dest, '공개 저장소를 clone한 폴더를 주세요') !== dest)
    throw new Error('공개 저장소를 clone한 폴더의 맨 위를 주세요')
  const common = (dir: string) =>
    real(text(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
  if (common(dest) === common(src)) throw new Error('개발 저장소의 worktree에는 내보내지 않습니다')
  let origin = ''
  try {
    origin = text(dest, 'remote', 'get-url', 'origin')
  } catch {
    // origin이 없으면 아래에서 거절한다
  }
  if (!PUBLIC_REMOTE.test(origin)) throw new Error('origin이 공개 저장소가 아닌 폴더입니다')
  if (text(dest, 'rev-parse', '--is-shallow-repository') === 'true')
    throw new Error('얕은 clone(--depth)에는 내보내지 않습니다. 공개 저장소를 그냥 clone해 주세요')
  // 이름을 바꾼 개발 저장소로 가는 옛 주소 전환을 따라 받은 clone이면 개발 기록이 들어 있다
  const devCommits = [
    ...text(src, 'rev-list', '--max-parents=0', 'HEAD').split('\n'),
    text(src, 'rev-parse', 'HEAD'),
  ]
  const shared = devCommits.some((root) => {
    try {
      git(dest, 'cat-file', '-e', `${root}^{commit}`)
      return true
    } catch {
      return false
    }
  })
  if (shared)
    throw new Error('개발 저장소의 기록이 있는 폴더입니다. 새로 만든 공개 저장소를 clone해 주세요')
  checkCommitted(dest)
}

/**
 * 대상의 파일이 모두 대상 HEAD에 커밋된 그대로인지 디스크에서 직접 본다. git status는 설정
 * (status.showUntrackedFiles)·ignore·assume-unchanged로 파일과 변경을 숨길 수 있다.
 */
function checkCommitted(dest: string) {
  const again = '공개 저장소를 새로 clone해 주세요'
  try {
    git(dest, 'diff', '--cached', '--quiet')
  } catch {
    throw new Error(`스테이지에 올린 변경이 있는 폴더입니다. ${again}`)
  }
  const committed = new Map<string, string>()
  let head = true
  try {
    git(dest, 'rev-parse', '--verify', '--quiet', 'HEAD')
  } catch {
    head = false // 아직 커밋이 없는 새 저장소
  }
  if (head)
    for (const line of text(dest, 'ls-tree', '-r', '-z', 'HEAD').split('\0')) {
      const [meta, path] = line.split('\t')
      if (path) committed.set(path, meta.split(' ')[2])
    }
  const onDisk: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!rel && entry.name === '.git') continue
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), path)
      // 링크·FIFO 같은 것은 따라가거나 읽지 않고 거절한다
      else if (entry.isFile()) onDisk.push(path)
      else throw new Error(`일반 파일이 아닌 항목(링크 등)이 있는 폴더입니다. ${again}`)
    }
  }
  walk(dest, '')
  if (onDisk.some((path) => !committed.has(path)))
    throw new Error(`커밋하지 않은 파일(무시 파일 포함)이 있는 폴더입니다. ${again}`)
  // hash-object --stdin-paths는 "로 시작하는 줄을 풀어 읽고 줄 끝 CR을 지워, 다른 파일을 해시한다
  if (onDisk.some((path) => path.startsWith('"') || /[\r\n]/.test(path)))
    throw new Error(`이름이 따옴표로 시작하거나 줄바꿈 문자가 든 파일이 있는 폴더입니다. ${again}`)
  const hashes = onDisk.length
    ? // --no-filters: ident·clean 필터·줄바꿈 변환을 거치면 고친 내용도 커밋과 같은 해시가 나올 수 있다
      execFileSync('git', ['hash-object', '--no-filters', '--stdin-paths'], {
        cwd: dest,
        env,
        input: `${onDisk.join('\n')}\n`,
      })
        .toString()
        .trim()
        .split('\n')
    : []
  if (hashes.length !== onDisk.length || hashes.some((h, i) => h !== committed.get(onDisk[i])))
    throw new Error(`커밋한 내용과 다른 파일이 있는 폴더입니다. ${again}`)
}

export function exportPublic(target: string, root = process.cwd()) {
  const src = topLevel(root, '개발 저장소 안에서 실행해 주세요')
  let dest: string
  try {
    dest = real(target)
  } catch {
    throw new Error('공개 저장소를 clone한 폴더를 주세요')
  }
  checkTarget(dest, src)
  const files: { path: string; mode: string }[] = []
  for (const line of text(src, 'ls-tree', '-r', '-z', 'HEAD').split('\0')) {
    const [meta, path] = line.split('\t')
    if (!path || PRIVATE.some((p) => path.startsWith(p))) continue
    const [mode, type] = meta.split(' ')
    if (type !== 'blob' || mode === '120000')
      throw new Error(`파일이 아닌 항목은 내보내지 않습니다: ${path}`)
    // git은 이런 경로를 checkout하지 않지만, 트리를 직접 만들면 HEAD에 들어갈 수 있다
    const unsafe = path.split('/').some((s) => ['', '.', '..', '.git'].includes(s.toLowerCase()))
    if (unsafe || path.includes('\\')) throw new Error(`내보낼 수 없는 경로입니다: ${path}`)
    files.push({ path, mode })
  }
  for (const entry of readdirSync(dest))
    if (entry !== '.git') rmSync(join(dest, entry), { recursive: true, force: true })
  for (const { path, mode } of files) {
    const file = join(dest, path)
    mkdirSync(dirname(file), { recursive: true })
    const blob = git(src, 'show', `HEAD:${path}`)
    writeFileSync(file, path === 'AGENTS.md' ? publicAgents(blob.toString('utf8')) : blob)
    if (mode === '100755') chmodSync(file, 0o755)
  }
  return files.map((f) => f.path)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]
  if (!target) {
    console.error('사용: node scripts/export-public.ts <공개 저장소를 clone한 폴더>')
    process.exit(1)
  }
  const count = exportPublic(target).length
  console.log(`${count}개 파일을 ${realpathSync.native(target)}에 내보냈습니다.`)
}
