# Ask-Codex on Windows — 다른 프로젝트의 Claude를 위한 가이드

> 작성: 2026-05-23 · multicli (osanoai/multicli)
> 검증 패킷: `tmp/R-20260523-134247-9zl-...` (5.3/5.4), `tmp/R-20260523-141040-gpt55-test/` (5.5), 인터랙티브 세션 (5.3 텍스트 전용)
> 대상: multicli MCP 서버의 `Ask-Codex` 도구를 호출하는 다른 프로젝트의 Claude (또는 사람) — 0 컨텍스트에서 읽고 바로 행동 가능

## TL;DR — 즉시 적용할 권장사항

Windows 환경에서 `mcp__Multi-CLI__Ask-Codex` 호출 시 **작업 유형 × 모델** 두 축으로 결정한다. 5.3-codex 는 차단 대상이 아니라 **사용처 분리** 대상이다.

| 작업 유형                                | gpt-5.3-codex | gpt-5.4      | gpt-5.5      | gpt-5.4-mini |
|------------------------------------------|---------------|--------------|--------------|--------------|
| 텍스트 전용 (요약·리뷰·판정·분석)        | **OK**        | OK           | OK           | OK (즉답용)  |
| 파일 RW · 셸 실행 · 다단계 도구 호출     | **FAIL**      | **권장**     | OK           | 부적합 (tier)|
| 즉답·간단한 룩업                         | OK            | overkill     | overkill     | **권장**     |

**한 줄 룰**: 도구 호출이 들어가면 `gpt-5.4` 디폴트, 텍스트만이면 `gpt-5.3-codex` 도 무방.

## 배경 — 두 개의 별개 실패 모드

Windows 에서 Ask-Codex 는 두 단계로 프로세스를 spawn 한다:

1. **Outer spawn** — multicli 가 vendor `codex.exe` 를 띄움.
2. **Inner 도구 호출 경로** — codex 가 자기 작업을 위해 PowerShell/Node REPL/apply_patch 등 subprocess 체인을 띄움.

### 실패 모드 A — Outer (해결됨)
- 증상: `CreateProcessAsUserW failed: 5`
- 원인: codex CLI 가 `shell:true / detached` 모드로 spawn 될 때 Windows 토큰 권한 문제
- 해결: **multicli 1.5.40+ 의 launcher-mimick** (PR #139 / commit `fe16572`) — vendor `codex.exe` 를 `codex.js` 가 하는 방식 그대로 (`shell:false, detached:false`, `CODEX_MANAGED_*` env) 직접 spawn
- 추적: GitHub issue #138, bd `multicli-ncj`

### 실패 모드 B — Inner 회복 분기 결손 (5.3-codex 한정, open)
- 증상: `windows sandbox: spawn setup refresh` (raw error 로 멈춤)
- **변곡점 (5.3↔5.4 사이)**: codex 가 PS sandbox 초기화에 실패하면 자동으로 Node REPL → `apply_patch` 등 **권한 상승/우회 도구 체인** 으로 분기하는 회복 로직. 이 회복 분기는 **5.4 부터 도입**됨. **5.3-codex 에는 없음** → 같은 PS 실패에서 그대로 멈춰 raw error 노출.
- 발현 조건: `gpt-5.3-codex` × 파일 RW / 셸 실행 / 도구 호출 작업
- **텍스트 전용 작업에서는 5.3-codex 도 정상** (회복 분기 자체가 불필요한 경로). 인터랙티브 세션에서 텍스트 리뷰어 역할 수행 + 한국어 응답 + 제약 준수 모두 정상 동작 확인됨.
- 우회: 도구 호출이 필요한 작업은 `gpt-5.4` 이상 사용
- 추적: bd `multicli-767` (vendor regression, multicli 코드 변경 없음)

> 참고로 raw-stdout 에 나타나는 *"PowerShell 실행 환경 초기화가 실패해서…"* 메시지는 PL 환경에서 항상 보이는 노이즈다. PS 초기 실패는 모든 모델 공통이고, 차이는 그 후의 회복 분기 진입 여부.

## 실증 (재현 가능)

같은 file-RW 프롬프트 (`tmp/<packet>/*.txt` 작성 → 다시 읽어 출력) 로 2026-05-23 검증:

| # | 시각  | 모델            | 호출 경로            | 결과   | 디스크 증거 |
|---|-------|-----------------|----------------------|--------|--------------|
| 1 | 13:42 | `gpt-5.3-codex` | multicli Ask-Codex   | FAIL   | 파일 미생성. raw: `windows sandbox: spawn setup refresh` |
| 2 | 13:44 | `gpt-5.4`       | multicli Ask-Codex   | PASS   | `codex-rw-evidence-attempt2.txt` 4줄 정확 |
| 3 | 14:11 | `gpt-5.5`       | vanilla `codex exec`*| PASS   | `proof-5.5.txt` 2줄 정확. raw-stdout 에 회복 분기 흐름 (PS fail → node_repl → apply_patch) 명시 캡처 |
| 4 | 14:29 | `gpt-5.3-codex` | 인터랙티브 (텍스트만)| PASS   | 텍스트 전용 리뷰어 역할 수행 정상 |

*: multicli 의 model allowlist 가 5.5 미포함이라 vendor codex 직호출. 5.5 catalog 등재는 별도 작업 (bd `multicli-0v5`).

검증 환경: Windows 11 (10.0.26200), codex-cli 0.133.0, Claude Code fresh session.

## 다른 Claude 가 자기 환경에서 검증하는 5단계 레시피

```text
1. Multi-CLI MCP 가 붙어 있는지 확인 (mcp__Multi-CLI__Ask-Codex 도구 존재).
2. tmp/ 하위에 검증용 디렉토리 생성 (예: tmp/R-<ts>-codex-verify/).
3. 다음 프롬프트로 Ask-Codex 호출 (model = "gpt-5.4"):
     "tmp/R-<ts>-codex-verify/proof.txt 파일에 두 줄(아무 식별자 + ISO 8601 UTC 시각)을 쓰고,
      그 파일을 다시 읽어 출력해주세요. 마지막에 RW OK 보고."
4. Claude (호출자) 가 직접 디스크에서 proof.txt 존재 + 내용 확인.
5. (선택) 같은 프롬프트를 model = "gpt-5.3-codex" 로 반복하여 본 가이드의 변곡점 가설을 재현.
   추가로, 5.3-codex 가 텍스트 전용 작업에서는 정상임을 확인하려면 같은 모델에 도구 호출 없는 분석/판정 프롬프트도 시도.
```

> 주의: Ask-Codex 는 long-running (1–15분). 결과를 잘못 기다리지 말고 도구 응답을 그대로 받는다.

## 호출 템플릿 (복붙용)

### 도구 호출 작업 (파일 RW / 셸 / 다단계)
```typescript
mcp__Multi-CLI__Ask-Codex({
  model: "gpt-5.4",               // 회복 분기 보유 → 안정적
  prompt: "...작업 설명만. 파일 사전 읽기 금지 — Codex 가 직접 탐색...",
})
```

### 텍스트 전용 작업 (요약·리뷰·판정)
```typescript
mcp__Multi-CLI__Ask-Codex({
  model: "gpt-5.3-codex",         // 텍스트 작업은 OK, balanced tier
  prompt: "...분석/판정 요청. 도구 호출 불필요한 작업만...",
})
```

호출자(Claude) 가 미리 파일을 읽어 prompt 에 inline 하지 말 것 — Codex 는 작업 디렉토리 풀 접근이 있어 직접 탐색이 정상 경로다. **단** 5.3-codex 에 도구 호출 작업을 시킬 때만 예외로 inline 이 유효 (그 모델은 파일을 직접 못 읽으므로).

## 한계 — 본 가이드가 stale 해질 조건

다음 중 하나라도 발생하면 본 가이드를 재검증해야 한다:

- multicli 1.5.40 (또는 그 이상) 정식 릴리스 후 — launcher-mimick 이 표준 패키지에 포함되어 manual patch 가 불필요해진다.
- codex CLI vendor 가 5.3-codex 에도 회복 분기를 백포팅 — bd `multicli-767` 가 해소되면 5.3-codex 도 도구 호출 작업 안전 영역으로 옮길 수 있다.
- 다른 OS (macOS/Linux) — 본 가이드의 두 실패 모드는 Windows 한정이다.
- gpt-5.5 가 multicli catalog 에 정식 등재 (bd `multicli-0v5` Probe 통과) — vanilla codex 직호출 우회가 불필요해진다.

## 참고

- PR: https://github.com/osanoai/multicli/pull/139
- GitHub issue: https://github.com/osanoai/multicli/issues/138
- bd issues: `multicli-ncj` (PR 트래킹), `multicli-767` (5.3-codex 회복 분기 결손 follow-up), `multicli-9zl` (5.3/5.4 검증, closed), `multicli-0v5` (5.5 catalog 등재)
- 검증 패킷:
  - `tmp/R-20260523-134247-9zl-launcher-mimick-verification/SUMMARY.md` (5.3 FAIL, 5.4 PASS)
  - `tmp/R-20260523-141040-gpt55-test/SUMMARY.md` (5.5 PASS + 변곡점 본질 분석)
