export const VERSION = '0.2.1'
export type Host = 'claude' | 'chatgpt'
export const BASE_URL = 'https://ys.learnus.org'
// 공식 저장소 (문제 신고·업데이트 안내용)
export const REPO_URL = 'https://github.com/HyungJuHan07/learnus-mcp'
// 연세포털 로그인 서버. 로그인할 때만 간다 (auth.ts).
export const PORTAL_URL = 'https://infra.yonsei.ac.kr'

// 조회용 Moodle AJAX 함수만. 여기 없는 이름은 client.ts가 전송 직전에 막는다.
// 실제 사이트에서 동작 확인. 강좌 목록 함수는 LearnUs에서 invalidrecord라 대시보드 HTML을 쓴다.
export const AJAX_FUNCTIONS: ReadonlySet<string> = new Set([
  'core_calendar_get_action_events_by_timesort',
])
export const AJAX_PATH = '/lib/ajax/service.php'

/** 환경변수 읽기. .mcpb에서 비워 둔 선택 항목은 "${user_config.x}" 그대로 올 수 있어 무시한다. */
export function env(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v && !v.startsWith('${') ? v : undefined
}
