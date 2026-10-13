import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const MSG = 'client.ts를 거쳐 요청하세요.'
// 직접 연결·다른 프로세스로 우회하는 길까지 막는다 (module은 createRequire 우회)
const NET = ['http', 'https', 'http2', 'undici', 'net', 'tls', 'dgram', 'child_process', 'module']
const NET_MODULES = NET.flatMap((n) => [n, `node:${n}`])
// fetch는 client.ts에서만 쓴다. 나머지는 client.ts에서도 금지.
const NET_GLOBALS = ['WebSocket', 'EventSource'].map((name) => ({ name, message: MSG }))
const restrictGlobals = (globals) => ['error', { globals, checkGlobalObject: true }]

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // stdout은 MCP stdio 통신 채널이다. 여기에 찍으면 프로토콜이 깨진다.
      'no-console': ['error', { allow: ['error'] }],
      // 학교 서버로 가는 요청은 client.ts 한 곳만 거친다 (허용 도메인·메서드 강제).
      'no-restricted-globals': restrictGlobals([{ name: 'fetch', message: MSG }, ...NET_GLOBALS]),
      'no-restricted-imports': ['error', { paths: NET_MODULES }],
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.value=/^(node:)?(${NET.join('|')})$/]`,
          message: MSG,
        },
        // import('node:'+'https')처럼 문자열을 만들어 불러오면 위 검사를 피한다
        { selector: `ImportExpression:not([source.type='Literal'])`, message: MSG },
        {
          selector: `MemberExpression[property.name='getBuiltinModule'], MemberExpression[property.value='getBuiltinModule']`,
          message: MSG,
        },
        // globalThis['fe'+'tch']
        {
          selector: `MemberExpression[object.name='globalThis'][computed=true]:not([property.type='Literal'])`,
          message: MSG,
        },
      ],
    },
  },
  { files: ['src/cli.ts'], rules: { 'no-console': 'off' } },
  {
    files: ['src/credentials.ts'],
    rules: {
      // 고정 OS 금고 헬퍼의 파이프만. shell·임의 명령·학교 네트워크 우회 금지.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NET_MODULES.filter((n) => n !== 'node:child_process'),
            { name: 'node:child_process', allowImportNames: ['spawn'], message: MSG },
          ],
        },
      ],
    },
  },
  { files: ['src/client.ts'], rules: { 'no-restricted-globals': restrictGlobals(NET_GLOBALS) } },
)
