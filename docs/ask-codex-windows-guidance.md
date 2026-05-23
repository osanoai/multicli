# Ask-Codex on Windows — 다른 프로젝트의 Claude를 위한 가이드

> 작성: 2026-05-23 · multicli (osanoai/multicli) · 검증 패킷 `tmp/R-20260523-134247-9zl-...`
> 대상: multicli MCP 서버의 `Ask-Codex` 도구를 호출하는 다른 프로젝트의 Claude (또는 사람) — 0 컨텍스트에서 읽고 바로 행동 가능

## TL;DR — 즉시 적용할 권장사항

Windows 환경에서 `mcp__Multi-CLI__Ask-Codex` 를 호출할 때, **파일 RW / 도구 실행이 포함된 작업이면 `model: "gpt-5.4"` 를 우선 사용**한다. `gpt-5.3-codex` 는 같은 작업에서 inner sandbox 실패로 빈손으로 돌아올 수 있다.

| 작업 성격                           | 권장 모델          | 사유                                            |
|-------------------------------------|--------------------|-------------------------------------------------|
| 파일 RW, 셸/도구 호출, 다단계 작업  | `gpt-5.4`          | 검증 PASS (실증)                                |
| 단순 질의 응답·코드 리뷰만          | `gpt-5.3-codex` OK | 도구 호출이 없으면 inner sandbox 미진입         |
| 즉답·간단한 룩업                    | `gpt-5.4-mini`     | 표준 catalog 의 fast tier                       |

## 배경 — 두 개의 별개 실패 모드

Windows 에서 Ask-Codex 는 두 단계로 프로세스를 spawn 한다:

1. **Outer spawn** — multicli 가 vendor `codex.exe` 를 띄움.
2. **Inner sandbox** — codex 가 자기 작업을 위해 PowerShell/도구 subprocess 를 띄움.

### 실패 모드 A — Outer (해결됨)
- 증상: `CreateProcessAsUserW failed: 5`
- 원인: codex CLI 가 `shell:true / detached` 모드로 spawn 될 때 Windows 토큰 권한 문제
- 해결: **multicli 1.5.40+ 의 launcher-mimick** (PR #139 / commit `fe16572`) — vendor `codex.exe` 를 `codex.js` 가 하는 방식 그대로 (`shell:false, detached:false`, `CODEX_MANAGED_*` env 세팅) 직접 spawn
- 추적: GitHub issue #138, bd `multicli-ncj`

### 실패 모드 B — Inner sandbox (open)
- 증상: `windows sandbox: spawn setup refresh`
- 발현 조건: `gpt-5.3-codex` 모델로 도구 호출(파일 RW 등) 시도 시
- 원인 가설: codex 내부 sandbox harness 가 모델별 tool-call 형태에 따라 다르게 동작. `gpt-5.4` 는 미발현
- 우회: `gpt-5.4` 사용
- 추적: bd `multicli-767` (2026-05-23 open, P2)

## 실증 (재현 가능)

같은 프롬프트 (`tmp/<packet>/*.txt` 작성 → 다시 읽어 출력) 로 2026-05-23 13:42 KST 시도:

| 시도 | 모델            | 결과   | 디스크 증거 |
|------|-----------------|--------|--------------|
| 1    | `gpt-5.3-codex` | FAIL   | 파일 미생성. 에러: `windows sandbox: spawn setup refresh` |
| 2    | `gpt-5.4`       | PASS   | `codex-rw-evidence-attempt2.txt` 4줄 정확 |

검증 환경: Windows 11 (10.0.26200), Claude Code fresh session, Multi-CLI MCP 재기동 후.

## 다른 Claude 가 자기 환경에서 검증하는 5단계 레시피

```text
1. Multi-CLI MCP 가 붙어 있는지 확인 (mcp__Multi-CLI__Ask-Codex 도구 존재).
2. tmp/ 하위에 검증용 디렉토리 생성 (예: tmp/R-<ts>-codex-verify/).
3. 다음 프롬프트로 Ask-Codex 호출 (model = "gpt-5.4"):
     "tmp/R-<ts>-codex-verify/proof.txt 파일에 두 줄(아무 식별자 + ISO 8601 UTC 시각)을 쓰고,
      그 파일을 다시 읽어 출력해주세요. 마지막에 RW OK 보고."
4. Claude (호출자) 가 직접 디스크에서 proof.txt 존재 + 내용 확인.
5. (선택) 같은 프롬프트를 model = "gpt-5.3-codex" 로 반복하여 본 가이드의 가설을 재현.
```

> 주의: Ask-Codex 는 long-running (1–15분). 결과를 잘못 기다리지 말고 도구 응답을 그대로 받는다.

## 호출 템플릿 (복붙용)

```typescript
mcp__Multi-CLI__Ask-Codex({
  model: "gpt-5.4",               // Windows + 도구 사용 작업: 디폴트로 5.4
  prompt: "...작업 설명만. 파일 사전 읽기 금지 — Codex 가 직접 탐색...",
  // approvalPolicy, sandbox: 명시적 필요 없으면 디폴트 유지
})
```

호출자(Claude) 가 미리 파일을 읽어 prompt 에 inline 하지 말 것 — Codex 는 작업 디렉토리 풀 접근이 있어 직접 탐색이 정상 경로다.

## 한계 — 본 가이드가 stale 해질 조건

다음 중 하나라도 발생하면 본 가이드를 재검증해야 한다:

- multicli 1.5.40 (또는 그 이상) 정식 릴리스 후 — launcher-mimick 이 표준 패키지에 포함되어 manual patch 가 불필요해진다.
- codex CLI vendor 가 sandbox 동작을 바꿈 — bd `multicli-767` 의 fix 가 들어오면 `gpt-5.3-codex` 도 안전해질 수 있다.
- 다른 OS (macOS/Linux) — 본 가이드의 두 실패 모드는 Windows 한정이다.

## 참고

- PR: https://github.com/osanoai/multicli/pull/139
- GitHub issue: https://github.com/osanoai/multicli/issues/138
- bd issues: `multicli-ncj` (PR 트래킹), `multicli-767` (inner sandbox follow-up), `multicli-9zl` (검증, closed)
- 검증 패킷: `tmp/R-20260523-134247-9zl-launcher-mimick-verification/SUMMARY.md`
