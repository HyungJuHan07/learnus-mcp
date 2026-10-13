import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function stageChatGPT(root: string, destination: string, platform: NodeJS.Platform) {
  if (platform !== 'darwin' && platform !== 'win32') throw new Error('macOS·Windows만 지원합니다.')
  const helper = `learnus-credentials${platform === 'win32' ? '.exe' : ''}`
  const files = [
    ['dist/index.cjs', 'index.cjs'],
    ['dist/install.cjs', 'install.cjs'],
    [`dist/native/${helper}`, `native/${helper}`],
    ['dist/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
    ['LICENSE', 'LICENSE'],
    ['INSTALL_CHATGPT.md', 'INSTALL_CHATGPT.md'],
  ]
  for (const [source] of files) {
    if (!existsSync(join(root, source)))
      throw new Error('ChatGPT 배포 파일이 없습니다. 빌드부터 실행하세요.')
  }
  // 기존 설치 폴더를 패키징 대상 경로로 주더라도 덮어쓰지 않는다.
  mkdirSync(destination)
  mkdirSync(join(destination, 'native'))
  for (const [source, target] of files) copyFileSync(join(root, source), join(destination, target))
  cpSync(join(root, 'packaging/cmaps'), join(destination, 'cmaps'), { recursive: true })
  if (platform === 'darwin') chmodSync(join(destination, 'native', helper), 0o755)
}

function pack() {
  const root = resolve('.')
  const parent = mkdtempSync(join(root, 'dist', 'chatgpt-build-'))
  const stage = join(parent, 'package')
  const mac = process.platform === 'darwin'
  const label = mac ? 'macos' : 'windows'
  const name = `learnus-chatgpt-${label}.${mac ? 'tar.gz' : 'zip'}`
  try {
    stageChatGPT(root, stage, process.platform)
    execFileSync(
      // Git의 GNU tar가 PATH에 먼저 있으면 zip이 아닌 파일이 나오므로 윈도우 기본 tar.exe(bsdtar)를 쓴다
      mac ? '/usr/bin/tar' : join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
      [mac ? '-czf' : '-acf', join(root, 'dist', name), '-C', stage, ...readdirSync(stage)],
      { stdio: 'inherit' },
    )
    const hash = createHash('sha256')
      .update(readFileSync(join(root, 'dist', name)))
      .digest('hex')
    writeFileSync(join(root, 'dist', `SHA256SUMS-chatgpt-${label}`), `${hash}  ${name}\n`)
    console.log(`ChatGPT 배포물 생성: dist/${name}`)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) pack()
