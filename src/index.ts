import { runCli } from './cli.ts'
import { startServer } from './server.ts'
import { userMessage } from './client.ts'

// 인자가 없으면 AI 앱이 띄운 MCP 서버, 있으면 사람이 쓰는 명령.
const [command] = process.argv.slice(2)
;(command ? runCli(command) : startServer()).catch((error) => {
  console.error(userMessage(error, '알 수 없는 오류가 발생했습니다.'))
  process.exitCode = 1
})
