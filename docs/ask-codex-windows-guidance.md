# Ask-Codex on Windows — 다른 프로젝트의 Claude를 위한 가이드

> 작성: 2026-05-23 · 전면 개정: 2026-05-31 · multicli (osanoai/multicli) · 서명 shyang
> 대상: multicli MCP 서버의 `Ask-Codex` 도구를 호출하는 다른 프로젝트의 Claude (또는 사람) — 0 컨텍스트에서 읽고 바로 행동 가능
> 검증 패킷: `tmp/R-20260531-1003-5ce-reverify-0135/`, `tmp/R-20260531-1509-3ox-e2e-verify/RESULT.md` (preloader e2e PASS), `tmp/archive/2026-05/R-20260531-125725-388-codex-plan-review/` (설계 감사)

## 🔴 가장 중요한 사실 (2026-05-31 정정)

**codex 0.135.0+ on Windows 에서 codex 는 기존 파일을 "읽지" 못한다 — 전 모델·전 sandbox 공통이다.**

codex 의 Windows sandbox 가 **모든 subprocess spawn 을 차단**한다 (`windows sandbox: spawn setup refresh`, `exited -1 in 0ms`). 파일 읽기는 codex 가 내부적으로 PowerShell `Get-Content` 또는 Node `node_repl` subprocess 를 띄워야 하는데 둘 다 이 단계에서 죽는다. **모델(5.3/5.4/5.5)·sandbox 모드(read-only/workspace-write)와 무관**하다. (이전 가이드의 "5.4 + read-only 면 감사 OK" 는 **틀렸다** — 그때 PASS 라 본 건 전부 *쓰기* 테스트였고 순수 읽기는 검증된 적이 없었다.)

- **쓰기/패치는 된다**: codex 내부 `apply_patch`(subprocess 아님)를 쓰므로 5.4+ 에서 동작. 단 5.3 은 회복 분기가 없어 실패.
- **읽기는 안 된다**: 대응하는 내부 읽기 도구가 없다. 모든 읽기는 차단된 sandbox spawn 을 탄다.

→ 진짜 결정 축은 "모델 × sandbox" 가 아니라 **읽기(깨짐) vs 쓰기(5.4) vs 텍스트 전용(아무 모델)** 이다.

## TL;DR — 즉시 적용할 권장사항

| 작업 유형 | 권장 | 비고 |
|---|---|---|
| **`.md` 파일을 읽어 감사/요약/리뷰** | 그냥 경로를 prompt 에 적고 `gpt-5.4` 호출 | **multicli 1.5.41+ 가 .md 를 자동 inline** (아래 §preloader). codex 는 디스크를 안 읽음 |
| **`.md` 외 파일 읽기** (.txt/.json/.ts/소스코드 등) | **호출자가 내용을 prompt 에 직접 inline** | codex 가 못 읽음. preloader 도 .md 만 커버 |
| **파일 쓰기/생성/패치** | `gpt-5.4` (apply_patch) | 5.3-codex 부적합 (회복 분기 없음) |
| **텍스트 전용** (요약·판정·분석, 파일 무관) | 아무 모델 (`gpt-5.3-codex` 도 OK, balanced) | subprocess 0개라 항상 안전 |
| 즉답·간단 룩업 | `gpt-5.4-mini` | — |

**한 줄 룰**: codex 에게 "기존 파일을 읽으라" 시키지 마라. `.md` 면 multicli 가 알아서 inline 하고(1.5.41+), 그 외 타입이면 **네가(호출자) 내용을 prompt 에 붙여 넣어라**. 쓰기/패치는 `gpt-5.4`.

## multicli Markdown preloader (1.5.41+, Windows 한정)

호출 전 multicli(샌드박스 없는 일반 Node 프로세스)가 prompt 안의 `.md`/`.markdown` 참조를 **직접 읽어 inline** 한 뒤 codex 를 호출한다. codex 는 "이미 들어온 텍스트"만 감사한다 — subprocess 0개. (bd `multicli-wr8`, e2e PASS `multicli-3ox`)

- **대상**: 프롬프트에 명시된 `.md`/`.markdown` 참조만. 디렉토리 스캔·glob·임의 확장자 자동 포함 **안 함**.
- **탐지 신호 필요**: 경로 구분자(`docs/x.md`)·`@`접두·따옴표/백틱 래핑·또는 인접 read/review 동사(읽/리뷰/요약/감사…) 중 하나. 신호 없는 bare 파일명 단독(`README.md`)은 토픽 언급으로 보고 **무시**(오탐 방지).
- **안전**: cwd / MCP projectRoots 내부만, `..`·타-드라이브·심링크 탈출 차단. per-file 200KB / 총 500KB 초과 시 codex 미호출 + 명확한 에러.
- **opt-out**: `MULTICLI_WINDOWS_CODEX_NO_PRELOAD=1`.
- **비-Windows**: 동작 안 함(codex 가 정상적으로 읽을 수 있는 플랫폼) — prompt 그대로 통과.

호출 예 (`.md` 감사 — 그냥 경로만 적으면 됨):
```typescript
mcp__Multi-CLI__Ask-Codex({
  model: "gpt-5.4",
  prompt: "docs/review.md 를 읽고 문제점을 찾아줘",   // multicli 가 review.md 내용을 자동 inline
})
```

## 호출자가 직접 inline 해야 하는 경우 (.md 외 / preloader off)

codex 가 못 읽는 파일을 감사시키려면 **네가 읽어서 prompt 에 붙여라**. 이게 전 모델에서 안전하다(텍스트 작업).
```typescript
// 예: .txt 패킷 감사
mcp__Multi-CLI__Ask-Codex({
  model: "gpt-5.3-codex",   // 텍스트 전용이면 balanced 도 OK
  prompt: `다음은 tmp/packet/SUMMARY.txt 전체 내용입니다. 감사해주세요.\n\n<file>\n${파일내용}\n</file>\n\n검증 항목: ...`,
})
```

## 근본 원인 (실증)

| # | 테스트 (codex 0.135.0, Win11) | 결과 |
|---|---|---|
| 1 | 5.4 + workspace-write + **파일 쓰기** (apply_patch) | PASS (디스크 검증) |
| 2 | 5.3 + read-only + **읽기** | FAIL `spawn setup refresh` |
| 3 | 5.4 + read-only + **읽기** | FAIL `spawn setup refresh` |
| 4 | 5.4 + workspace-write + **순수 읽기** | FAIL (codex 가 `Get-Content`/`node_repl` 시도 → 둘 다 spawn 실패) |
| 5 | preloader inline + 텍스트 감사 (전 모델) | PASS |

트랜스크립트상 `git status` 같은 **직접 .exe** 는 approval 로 샌드박스 **밖** 실행 시 되지만, sandbox 내 PowerShell/Node spawn 은 `exited -1 in 0ms` 로 즉사한다 → codex 벤더 sandbox-setup 계층 버그.

## 검증으로 기각된 가설 (반복 금지)

| 가설 | 결과 |
|---|---|
| multicli env `CODEX_MANAGED_PACKAGE_ROOT` 오설정이 원인 | **기각** — 올바른 값(메인 패키지 루트)으로 직접 spawn 해도 읽기 동일 실패. (정합성 개선으로는 유지하나 읽기와 무관) |
| WindowsApps(Store) pwsh 가 문제 | **기각** — 비-WindowsApps pwsh(System32 복사본) 강제해도 동일 실패 |
| "Node FS API 써라" 프롬프트 주입하면 읽음 | **기각** — codex 가 `node_repl` 시도 → 그것도 subprocess spawn → 동일 실패 |
| `sandbox: read-only` 면 안전하게 읽힘 | **기각** — readonly 도 파일 읽기에 subprocess 를 띄움 → 동일 실패 |

## sandbox 파라미터 (플랫폼 무관 의미)

`Ask-Codex` 의 `sandbox` 는 codex 의 **쓰기 권한** 범위다 (읽기 가능 여부와 무관 — Windows 에선 어차피 읽기 불가).
- (생략) = `workspace-write` + auto-approve (기본).
- `"read-only"` = 쓰기/실행 차단 (감사 시 codex 가 파일을 건드리면 안 될 때). **단 Windows 에선 readonly 라도 읽기 자체가 안 되므로 inline 이 전제**.
- `"danger-full-access"` = 권장하지 않음(정책상 비대화형 노출 금지).

## 다른 Claude 가 자기 환경에서 검증하는 레시피

```text
1. mcp__Multi-CLI__Ask-Codex 도구 존재 확인 + multicli 버전(1.5.41+ 면 preloader 내장).
2. 검증용 .md 작성: tmp/R-<ts>-verify/proof.md 에 2줄 (식별자 + ISO8601 UTC).
3. 호출(읽기 감사): Ask-Codex({ model:"gpt-5.4", prompt:"tmp/R-<ts>-verify/proof.md 를 읽고 줄 수와 1번째 줄 보고" })
4. PASS = codex 가 inline 내용을 정확히 보고 + "spawn setup refresh"/READ-FAIL 없음.
   (1.5.41 미만이면 FAIL 재현 → preloader 부재 확인)
5. 대조(쓰기): 같은 모델로 "tmp/.../w.md 에 두 줄 써라" → apply_patch 로 PASS (쓰기는 원래 됨).
```
> 주의: Ask-Codex 는 long-running(1–15분). 도구 응답을 그대로 받는다.

## 한계 — 본 가이드가 stale 해질 조건

- codex 벤더가 Windows sandbox subprocess-spawn 을 고치면 → 읽기가 직접 가능해져 preloader 불필요(그땐 opt-out/제거). bd `multicli-767`/`multicli-5ce` 추적.
- preloader 는 **.md 만** 커버 — `.txt`/`.json`/소스코드 읽기 감사는 여전히 호출자 inline 필요. 확장은 별도 작업.
- 다른 OS(macOS/Linux): 본 read 차단은 Windows 한정 — codex 가 정상적으로 읽는다(preloader 도 비활성).

## 참고

- bd: `multicli-wr8` (preloader feature), `multicli-3ox` (e2e PASS), `multicli-5ce`/`multicli-767` (벤더 read 차단 추적), `multicli-0v5` (5.5 catalog)
- 코드: `src/utils/codexFilePreloader.ts`, `src/utils/codexExecutor.ts` (`WindowsSandboxError`), `src/tools/ask-codex.tool.ts`
- GitHub issue: https://github.com/osanoai/multicli/issues/138
- 검증 패킷: `tmp/R-20260531-1509-3ox-e2e-verify/RESULT.md`
