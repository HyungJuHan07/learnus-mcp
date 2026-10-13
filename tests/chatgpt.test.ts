import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  readCredentials: vi.fn(),
  writeCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  rejectCredentials: vi.fn(),
}))
vi.mock('../src/credentials.ts', () => vault)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

async function connect() {
  const { createChatGPTServer } = await import('../src/chatgpt.ts')
  const [a, b] = InMemoryTransport.createLinkedPair()
  const server = createChatGPTServer()
  await server.connect(a)
  const client = new Client({ name: 'synthetic-test', version: '1' })
  await client.connect(b)
  return client
}

describe('ChatGPT MCP', () => {
  it('연결·목록·도움말은 금고·학교를 열지 않고 같은 도구 10개를 제공한다', async () => {
    const fetch = vi.fn(() => {
      throw new Error('network must not run')
    })
    vi.stubGlobal('fetch', fetch)
    const client = await connect()
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'download_material',
        'get_announcement',
        'get_assignment_detail',
        'get_today_briefing',
        'get_upcoming_deadlines',
        'learnus_help',
        'list_announcements',
        'list_courses',
        'list_materials',
        'list_unwatched_videos',
      ])
      const help = await client.callTool({ name: 'learnus_help', arguments: {} })
      expect(JSON.stringify(help)).toContain('OpenAI')
      expect(JSON.stringify(help)).not.toContain('Anthropic')
      expect(client.getInstructions()).toContain('비밀번호')
      expect(vault.readCredentials).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it('금고가 없으면 Claude 환경변수가 있어도 로그인하지 않고 등록 방법을 안내한다', async () => {
    vi.stubEnv('LEARNUS_USERNAME', 'synthetic-user')
    vi.stubEnv('LEARNUS_PASSWORD', 'synthetic-value')
    vault.readCredentials.mockResolvedValue(undefined)
    const fetch = vi.fn(() => {
      throw new Error('network must not run')
    })
    vi.stubGlobal('fetch', fetch)
    const client = await connect()
    try {
      const result = await client.callTool({ name: 'list_courses', arguments: {} })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('credentials-set')
      expect(JSON.stringify(result)).not.toContain('synthetic-value')
      expect(fetch).not.toHaveBeenCalled()
      expect(vault.readCredentials).toHaveBeenCalledOnce()
    } finally {
      await client.close()
    }
  })

  it('금고에서 온 한글 비밀번호도 기존 로그인 보호를 거쳐 전송하지 않는다', async () => {
    vault.readCredentials.mockResolvedValue({
      username: 'synthetic-user',
      password: '가짜비밀번호', // check-secrets: allow
    }) // check-secrets: allow
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = await connect()
    try {
      const result = await client.callTool({ name: 'list_courses', arguments: {} })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('credentials-set')
      expect(JSON.stringify(result)).not.toContain('가짜비밀번호')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it('다른 대화에서 실패 표시가 남은 값은 보내지 않고 다시 저장하라고 안내한다', async () => {
    vault.readCredentials.mockResolvedValue({
      username: 'synthetic-user',
      password: 'synthetic-value', // check-secrets: allow
      rejected: 'WRONG_PASSWORD',
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = await connect()
    try {
      const result = await client.callTool({ name: 'list_courses', arguments: {} })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('새 대화에서도 같은 비밀번호를 보내지 않습니다')
      expect(JSON.stringify(result)).toContain('다시 저장')
      expect(fetch).not.toHaveBeenCalled()
      expect(vault.rejectCredentials).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  })

  it.each([
    ['비밀번호를 보낸 뒤 실패', 'WRONG_PASSWORD', true],
    ['보내기 전에 멈춘 실패', 'LAYOUT_CHANGED', false],
  ] as const)('%s(%s)일 때만 금고에 실패 표시를 남긴다', async (_, code, lockoutRisk) => {
    const value = { username: 'synthetic-user', password: 'synthetic-value' } // check-secrets: allow
    vault.readCredentials.mockResolvedValue(value)
    vault.rejectCredentials.mockResolvedValue(undefined)
    const login = vi.fn()
    vi.resetModules()
    vi.doMock('../src/auth.ts', async (original) => ({
      ...(await original<typeof import('../src/auth.ts')>()),
      login,
    }))
    try {
      const { LoginError } = await import('../src/auth.ts')
      const failure = new LoginError(code)
      failure.lockoutRisk = lockoutRisk
      login.mockRejectedValue(failure)
      const client = await connect()
      try {
        const result = await client.callTool({ name: 'list_courses', arguments: {} })
        expect(result.isError).toBe(true)
        if (lockoutRisk) expect(vault.rejectCredentials).toHaveBeenCalledWith(value, code)
        else expect(vault.rejectCredentials).not.toHaveBeenCalled()
      } finally {
        await client.close()
      }
    } finally {
      vi.doUnmock('../src/auth.ts')
      vi.resetModules()
    }
  })

  it('실패 표시를 남기지 못하면 새 대화에서 한 번 더 갈 수 있다고 정직하게 알린다', async () => {
    vault.readCredentials.mockResolvedValue({
      username: 'synthetic-user',
      password: 'synthetic-value', // check-secrets: allow
    })
    vault.rejectCredentials.mockRejectedValue(new Error('synthetic-private-marker'))
    const login = vi.fn()
    vi.resetModules()
    vi.doMock('../src/auth.ts', async (original) => ({
      ...(await original<typeof import('../src/auth.ts')>()),
      login,
    }))
    try {
      const { LoginError } = await import('../src/auth.ts')
      const failure = new LoginError('WRONG_PASSWORD')
      failure.lockoutRisk = true
      login.mockRejectedValue(failure)
      const client = await connect()
      try {
        const result = JSON.stringify(
          await client.callTool({ name: 'list_courses', arguments: {} }),
        )
        expect(result).toContain('한 번 더 보낼 수 있습니다')
        expect(result).not.toContain('synthetic-private-marker')
      } finally {
        await client.close()
      }
    } finally {
      vi.doUnmock('../src/auth.ts')
      vi.resetModules()
    }
  })

  it('비대화형 금고 관리 명령은 입력·저장·삭제를 하지 않는다', async () => {
    const { runCli } = await import('../src/cli.ts')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const original = process.exitCode
    try {
      for (const command of ['credentials-set', 'credentials-clear']) {
        await runCli(command)
        expect(process.exitCode).toBe(1)
      }
      expect(error).toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
      expect(vault.writeCredentials).not.toHaveBeenCalled()
      expect(vault.deleteCredentials).not.toHaveBeenCalled()
    } finally {
      process.exitCode = original
    }
  })
})
