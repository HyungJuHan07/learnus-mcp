import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = resolve('dist/native')
mkdirSync(out, { recursive: true })
if (process.platform === 'darwin') {
  const targets = ['arm64', 'x86_64']
  for (const arch of targets) {
    execFileSync(
      '/usr/bin/swiftc',
      [
        'native/keychain.swift',
        '-O',
        '-target',
        `${arch}-apple-macosx12.0`,
        '-module-cache-path',
        resolve('dist/swift-cache'),
        '-o',
        join(out, `credentials-${arch}`),
      ],
      { stdio: 'inherit' },
    )
  }
  execFileSync(
    '/usr/bin/lipo',
    [
      '-create',
      ...targets.map((arch) => join(out, `credentials-${arch}`)),
      '-output',
      join(out, 'learnus-credentials'),
    ],
    { stdio: 'inherit' },
  )
  // 링커는 arm64 쪽에만 ad-hoc 서명을 붙인다 → 합친 파일 전체(두 아키텍처)를 같은 이름으로 다시 서명
  execFileSync(
    '/usr/bin/codesign',
    [
      '--force',
      '--sign',
      '-',
      '--identifier',
      'learnus-credentials',
      join(out, 'learnus-credentials'),
    ],
    { stdio: 'inherit' },
  )
} else if (process.platform === 'win32') {
  const compiler = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  )
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/optimize+',
      '/reference:System.Web.Extensions.dll',
      `/out:${join(out, 'learnus-credentials.exe')}`,
      // csc는 '/'를 옵션 기호로 읽어 'native/credentials.cs'의 폴더를 잃는다 (CS1504) → 역슬래시 절대 경로
      resolve('native', 'credentials.cs'),
    ],
    { stdio: 'inherit' },
  )
} else {
  throw new Error('ChatGPT 금고 헬퍼는 macOS·Windows에서 빌드하세요.')
}
