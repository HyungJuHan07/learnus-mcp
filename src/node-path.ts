import { realpathSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * MCP 설정에 적을 node 경로. process.execPath는 실제 파일이라 Homebrew면
 * /opt/homebrew/Cellar/node/<버전>/bin/node처럼 버전이 들어가 업그레이드하면 사라진다.
 * PATH에 같은 파일을 가리키는 이름(/opt/homebrew/bin/node 등)이 있으면 그 이름을 쓴다.
 * (설치기 번들에도 들어가므로 서버 코드를 import하지 않는다)
 */
export function stableNodePath(execPath = process.execPath, path = process.env.PATH ?? '') {
  const real = (p: string) => {
    try {
      const r = realpathSync(p)
      return process.platform === 'win32' ? r.toLowerCase() : r
    } catch {
      return undefined
    }
  }
  const target = real(execPath)
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of path.split(delimiter)) {
    if (!isAbsolute(dir)) continue
    const candidate = join(dir, name)
    if (target && real(candidate) === target) return candidate
  }
  return execPath
}
