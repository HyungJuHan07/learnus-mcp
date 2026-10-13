// 설치 파일(.mcpb) 정보와 MCP 경계 검사. LearnUs에 접속하지 않는다 (서버를 띄우지 않음).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LearnUsError } from '../src/client.ts'
import { REPO_URL, VERSION } from '../src/config.ts'
import { reply } from '../src/server.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('packaging/mcpb/manifest.json'))

describe('설치 파일 정보', () => {
  it('manifest의 도구 목록이 server.ts에 등록한 도구와 같다', () => {
    const registered = [...read('src/server.ts').matchAll(/\btool\(\s*'([a-z_]+)'/g)].map(
      (m) => m[1],
    )
    expect(registered.length).toBeGreaterThan(0)
    const listed = manifest.tools.map((t: { name: string }) => t.name)
    expect(new Set(listed)).toEqual(new Set(registered))
    expect(listed.length).toBe(registered.length)
  })

  it('package.json·manifest·config.ts 버전이 같다', () => {
    expect(JSON.parse(read('package.json')).version).toBe(VERSION)
    expect(manifest.version).toBe(VERSION)
  })
})

describe('도구 오류 응답 (원칙 3)', () => {
  it('일반 오류는 고정 문구로만 바꾸고 원문·스택을 내보내지 않는다', async () => {
    const r = await reply(async () => {
      throw new Error('raw /Users/someone/secret sesskey=abc')
    })
    const text = r.content[0].text
    expect(r.isError).toBe(true)
    expect(text).toContain('LearnUs 정보를 가져오지 못했습니다.')
    expect(text).not.toMatch(/raw|someone|sesskey|\bat\s/)
    expect(text).toContain(VERSION)
    expect(text).toContain(`${REPO_URL}/issues`)
  })

  it('우리 오류(LearnUsError)는 그 문구를 보여 준다', async () => {
    const r = await reply(async () => {
      throw new LearnUsError('요청이 취소되었습니다.')
    })
    expect(r.content[0].text).toMatch(/^요청이 취소되었습니다\./)
  })

  it('결과는 JSON 글로 돌려준다', async () => {
    const r = await reply(async () => ({ a: 1 }))
    expect(r).toEqual({ content: [{ type: 'text', text: '{"a":1}' }] })
  })
})

describe('MCP 서버', () => {
  it('도구 호출마다 새 클라이언트(withSignal)를 만든다 — 한 번의 로그인 실패가 다음 호출을 막지 않게', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const { createServer } = await import('../src/server.ts')
    const DASH = `<html><body id="page-my-courses-dashboard"><script>M.cfg={}</script>
      <a class="course-link" href="https://ys.learnus.org/course/view.php?id=7"><div class="course-title"><h3>가짜과목</h3></div></a></body></html>`
    const perCall: unknown[] = []
    const base = {
      withSignal: (signal?: AbortSignal) => {
        const c = { get: async (url: string) => ({ url, text: DASH, contentType: 'text/html' }) }
        perCall.push({ c, signal })
        return c as never
      },
    }
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createServer(base).connect(a)
    const mcp = new Client({ name: 't', version: '1' })
    await mcp.connect(b)
    for (let i = 0; i < 2; i++) {
      const r = await mcp.callTool({ name: 'list_courses', arguments: {} })
      // 기본 client(get 없음)가 아니라 withSignal이 돌려준 client로 실행했어야 성공한다
      expect(r.isError).toBeFalsy()
    }
    expect(perCall).toHaveLength(2)
    expect(perCall.every((p) => (p as { signal?: unknown }).signal instanceof AbortSignal)).toBe(
      true,
    )
    await mcp.close()
  })
})
