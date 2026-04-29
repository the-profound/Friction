---
name: Notion2Replit
description: Planning Agent가 사용자로부터 Notion Queue 참조(requestId / pageUrl / 자동선택)를 받아 Task를 생성하는 스킬. 사용자가 "Queue 작업을 처리해줘", "Queue에서 개발 항목 골라서 구현해줘", "Queue DB → 개발 → Notion 업데이트" 같은 요청을 할 때 사용. Planning Agent는 Notion에 직접 연결하지 않고 Task만 생성하며, 실제 MCP 연결·구현·writeback은 Task Agent가 수행한다.
---

# Queue DB → Plan → Dev → Writeback

Notion Queue DB에서 작업 항목 하나를 선택하고, SSOT Docs DB에서 관련 문서를 해석하여 구현 계획을 수립한다.
필요 시 SSOT 문서 수정을 제안·승인·반영한 뒤 코드를 구현하고, 완료 결과를 Queue 항목에 다시 기록(writeback)한다.

---

## A. Planning Agent 역할

> **Planning Agent는 이 섹션만 읽고 수행한다. Notion MCP에 직접 연결하지 않는다.**

### A-1. 언제 이 흐름을 수행하는가

- 사용자가 "Queue 작업 처리해줘", "Queue에서 항목 골라서 구현해줘" 등을 요청할 때
- Planning Agent는 Notion MCP 도구를 사용할 수 없으므로, 직접 Queue를 조회하거나 구현하지 않는다.
- 대신 Queue 참조 정보를 담은 Task를 생성하고 종료한다. Task Agent가 나머지를 수행한다.

### A-2. Queue 참조 확인

사용자 메시지에서 아래 세 가지 중 하나를 파악한다.

1. **requestId**: 요청 ID 숫자 (예: "42번 Queue 처리해줘")
2. **pageUrl**: Notion 페이지 URL (예: "https://www.notion.so/... 처리해줘")
3. **자동선택**: 명시적 지정 없이 "알아서 골라줘" 또는 Queue 참조가 없는 경우

Queue 참조가 불명확하면 사용자에게 아래 중 하나를 물어본다.
- 요청 ID 숫자
- Notion 페이지 URL
- 또는 "자동선택"으로 진행할지 여부

### A-3. Task 생성

Queue 참조를 확인한 뒤 `bulkCreateProjectTasks`로 Task를 생성하고 종료한다.

생성할 Task의 제목: `[N2R] Notion Queue 처리 — <참조 요약>`
- requestId가 있으면: `[N2R] Notion Queue 처리 — 요청 ID <n>`
- pageUrl이 있으면: `[N2R] Notion Queue 처리 — <URL 앞 40자>`
- 자동선택이면: `[N2R] Notion Queue 처리 — 자동선택`

Task 설명은 아래 **A-4 Task 플랜 템플릿**을 그대로 사용한다. Planning Agent는 이 Task를 생성한 뒤 추가 작업 없이 종료한다.

### A-4. Task 플랜 템플릿

```markdown
## Notion Queue 참조

선택 방식: <requestId | pageUrl | 자동선택>
Request ID: <숫자, 없으면 (none)>
Page URL: <URL, 없으면 (none)>

## 수행 지침

Task Agent는 아래 섹션 B(Task Agent 실행 흐름)에 따라 Step 0부터 전체 워크플로우를 수행한다.
Notion2Replit 스킬의 `## B. Task Agent 실행 흐름`을 참고한다.

## Notion Writeback
구현 완료 후 Replit2Notion 스킬의 Quick Writeback 절차에 따라 원본 Queue 페이지를 업데이트한다.

Source Queue Page URL: <Task Agent가 Step 1~2에서 확정한 URL, 생성 시점에는 (none)>
Source Queue Request ID: <Task Agent가 Step 1~2에서 확정한 ID, 생성 시점에는 (none)>
Split: 1 of 1
```

> **참고**: `Source Queue Page URL`과 `Source Queue Request ID`는 Task Agent가 Step 1~2에서 Queue 항목을 확정한 뒤 Task 설명을 업데이트하거나 writeback 시점에 실제 값을 사용한다. Planning Agent가 생성 시점에는 `(none)`으로 채워도 된다.

---

## B. Task Agent 실행 흐름

> **Task Agent는 이 섹션을 읽고 Step 0부터 전체 워크플로우를 수행한다.**

### B-1. 진입점

Task 설명의 `## Notion Queue 참조` 섹션에서 아래를 파싱한다.
- `선택 방식`: requestId / pageUrl / 자동선택
- `Request ID`: 숫자 또는 (none)
- `Page URL`: URL 또는 (none)

파싱한 값으로 Step 1의 Queue 항목 선택 방법(A/B/C)을 결정한 뒤 Step 0부터 순서대로 실행한다.

---

## 1. 언제 사용하는가

- 사용자가 Notion Queue DB의 항목을 골라 개발 작업을 수행하도록 요청할 때
- Queue DB와 SSOT Docs DB가 Notion에 연결되어 있을 때
- 구현 후 Notion에 결과를 자동으로 기록(writeback)해야 할 때

---

## 2. 사전 조건

- Notion MCP: `.local/mcp_skills/notion_mcp_server/SKILL.md` 참고, 연결·인증 완료
- Replit Secrets
  - `NOTION_QUEUE_DB_URL`: Queue DB Notion URL
  - `NOTION_SSOT_DB_URL`: SSOT Docs DB Notion URL
  - (선택) `NOTION_EDIT_LOG_DB_URL`: Replit → Notion 수정 로그 DB URL
  - (선택) `NOTION_QUEUE_VIEW_URL`: Queue DB의 "개발 전 only + 개발 순서 오름차순" 필터 뷰 URL. 설정 시 Step 1에서 Path B(뷰 기반 단일 호출)를 우선 사용한다.
  - (선택) `NOTION_SSOT_VIEW_URL`: SSOT Docs DB의 보조 뷰 URL. 설정 시 Step 3에서 후보를 빠르게 좁히는 데 활용한다.

뷰 URL 시크릿 등록 방법
- Notion Queue DB에서 필터(개발 상태 = "개발 전") + 정렬(개발 순서 오름차순 → 요청 ID 오름차순)을 적용한 뷰를 만든다.
- 해당 뷰 URL을 복사한 뒤 `?v=...`, `&source=copy_link` 등 쿼리 파라미터를 제거해 정제한다.
- 정제된 URL을 `NOTION_QUEUE_VIEW_URL` 시크릿으로 등록한다.
- (선택) SSOT Docs DB에도 보조 뷰를 만들어 `NOTION_SSOT_VIEW_URL` 시크릿으로 등록한다.

환경 변수가 없으면 Step 0에서 사용자에게 요청한다.

---

## 3. 입력 스키마

### 3-1. Queue DB 속성 (NOTION_QUEUE_DB_URL)

- 요청 제목 (title): 요청 한 줄 요약
- 개발 상태 (status): 개발 전 / 개발 중 / 검토 필요 / 개발 완료
- 요청자 (person, 1명)
- 개발 순서 (number, 소수 허용): near-term 우선순위. 백로그는 비워둠.
- 개발 기록 (text): 배경/문제 + 개발 완료 후 결과 기록
- 영향 문서 (relation → SSOT Docs DB): 이 요청이 영향을 미치는 문서
- 요청 ID (auto_increment_id)
- 생성 일시 (created_time)
- 최종 편집 일시 (last_edited_time)

운영 규칙
- 백로그 vs 이번 스코프 분리: 개발 순서가 있는 요청만 near-term
- 우선순위 변경은 개발 순서를 소수로 조정해 끼워넣기
- 기본 정렬: 개발 상태 오름차순 → 개발 순서 오름차순 → 요청 ID 오름차순

### 3-2. SSOT DB 속성 (NOTION_SSOT_DB_URL)

- 문서 이름 (title)
- Owner (person)
- 작성 상태 (status): Draft / In Progress / Complete
- 개발 상태 (status): 개발 전 / 개발 중 / 검토 필요 / 개발 완료
- 유형 (select): Principles&Scope / Screen / Component / Data&Logic
- 화면 ID (text): 예) IN-00, ON-01

관계 규칙
- Queue DB의 "영향 문서"는 반드시 SSOT Docs DB의 레코드에 relation으로 연결한다.
- 요청 처리 시: (요청 페이지 → 영향 문서 목록)을 기준으로 업데이트/제안 범위를 결정한다.

### 3-3. Queue 항목 선택자

세 가지 방법 중 하나로 항목을 지정한다.
- by: requestId: 요청 ID 숫자로 직접 지정
- by: pageUrl: Notion 페이지 URL로 직접 지정
- by: filter: 개발 상태 필터 + 개발 순서 정렬로 자동 선택

---

## 4. 워크플로우 (Step 0 ~ Step 10)

### Step 0: 환경 변수 확인 (check_env_vars)

- 항상 가장 먼저 수행한다.
- 확인 키: NOTION_QUEUE_DB_URL, NOTION_SSOT_DB_URL, NOTION_EDIT_LOG_DB_URL, NOTION_QUEUE_VIEW_URL, NOTION_SSOT_VIEW_URL
- Secrets 실제 값은 bash로만 읽는다.
- Notion URL은 `?v=...`, `&source=copy_link` 등을 제거해 정제한다.
- NOTION_QUEUE_VIEW_URL이 존재하면 Step 1에서 Path B를 먼저 시도한다. (없으면 Path A로 직행)

정제 함수 (필요 최소)
- cleanNotionUrl(url): url에서 `?` 이후 제거
- maskDomain 옵션이 필요하면 에러 로그에서 도메인 마스킹 적용

### Step 1: Queue 항목 선택 (pick_queue_item)

Task 설명의 `## Notion Queue 참조`에서 파싱한 선택 방식에 따라 아래 중 하나를 우선 적용한다.
- requestId 또는 pageUrl이 있으면 → C) 직접 지정으로 시작
- 자동선택이면 → 우선순위 B → A 순으로 시도

우선순위 (자동선택 시): B → A → C

B) notionQueryDatabaseView (뷰 URL 시크릿이 있을 때 우선 시도)
- NOTION_QUEUE_VIEW_URL 시크릿이 설정되어 있을 때만 실행한다.
- 정제된 뷰 URL로 `notionQueryDatabaseView`를 호출해 한 번에 후보 목록을 받는다. (결과는 session_cache에 보관해 같은 세션에서 재사용. 사용자가 명시적으로 새로고침을 요청하면 캐시 무효화)
- 결과가 비어 있거나 호출 실패 시 즉시 Path A로 폴백한다.
- 결과에서 "개발 중" 항목은 제외하고 "개발 전" 항목만 유효 후보로 취급한다.
- 후보가 2개 이상이면 사용자에게 목록을 보여주고 선택을 받는다.
- 후보가 0개면 Path A로 폴백한다.

A) notionFetch + notionSearch (Path B 실패 또는 시크릿 없을 때 폴백)
- Queue DB를 fetch해서 collection URL을 얻는다. (결과는 session_cache에 보관해 같은 세션에서 재사용)
- 상태값(예: "개발 전")을 키워드로 search한다. (빈 쿼리 금지)
- 검색 결과 속성(개발 상태)으로 후보를 필터링한다. 후보별 개별 fetch는 생략한다.
  - "개발 중"은 제외
  - "개발 전"만 선택
- 후보가 2개 이상이면 사용자에게 목록을 보여주고 선택을 받는다.
- 최종 선택된 1건만 notionFetch로 상세 로드한다.
- 후보가 0개면 처리 가능한 항목이 없다고 알리고 중단한다.

C) requestId / pageUrl 직접 지정

출력
- queue_item_page_url, queue_item_properties

### Step 2: Queue 항목 로드 (load_queue_item)

- queue_item_page_url을 fetch하여 properties를 파싱한다.
- properties 파싱 실패 시 명시적으로 에러 처리한다. (조용한 폴백 금지)

### Step 3: SSOT 문서 해석 (resolve_ssot_docs)

우선순위
1) Queue 항목의 "영향 문서" relation
2) relation이 비었으면 아래 순서로 후보를 탐색한다.
   a) NOTION_SSOT_VIEW_URL이 설정된 경우: `notionQueryDatabaseView`로 후보를 빠르게 좁힌 뒤 키워드로 재필터링한다. (결과는 session_cache에 보관. 사용자가 명시적으로 새로고침을 요청하면 캐시 무효화) 실패하면 (b)로 폴백한다.
   b) 유형 매핑 + 키워드 검색 (기존 방식)

출력
- ssot_doc_page_urls

### Step 4: SSOT 문서 로드 (load_ssot_docs)

- 독립적인 SSOT 문서는 병렬 fetch한다 (최대 동시 3건). 순서 의존성이 없으면 동시 실행이 기본이다.
- 각 문서를 fetch해서 내용/속성을 확보한다.

### Step 5: 요구사항 추출 (extract_requirements)

Queue 항목 + SSOT를 종합하여 추출
- request_title
- dev_record
- constraints
- impacted_areas
- referenced_ssot_docs

### Step 6: 구현 계획 (plan)

- `.local/session_plan.md`에 아래를 작성한다.
  - plan_overview
  - task_breakdown
  - files_to_touch
  - test_plan
  - risks

- **task_breakdown의 마지막 단계는 반드시 Notion Quick Writeback이어야 한다.**
  - 이 단계는 `bulkCreateProjectTasks`로 생성되는 Task 플랜의 설명(description) 마지막에도 아래 섹션으로 포함시킨다.
  - Task가 단일이든 N개로 분리되든 아래 형식을 그대로 사용한다.

```markdown
## Notion Writeback
구현 완료 후 Replit2Notion 스킬의 Quick Writeback 절차에 따라 원본 Queue 페이지를 업데이트한다.

Source Queue Page URL: <원본 Queue 페이지 URL, 없으면 (none)>
Source Queue Request ID: <원본 Queue 요청 ID, 없으면 (none)>
Split: <i> of <N>
```

위 섹션 작성 규칙
- `Source Queue Page URL`과 `Source Queue Request ID`는 처리 중인 Queue 항목의 실제 값을 채운다.
- 원본 Queue가 없는 경우(채팅에서 바로 시작한 R2N 흐름)는 두 값 모두 `(none)`으로 명시한다.
- `Split: i of N`: 1개 Queue → 1개 Task면 `Split: 1 of 1`, 1개 Queue → N개 Task로 분리되면 각 Task에 `Split: 1 of N`, `Split: 2 of N`, … 식으로 순서대로 부여한다. 다수 Queue → 1개 Task로 묶이면 `Split: 1 of 1`로 처리하고 Source 줄을 Queue 수만큼 반복한다.

예시 A (단일 Queue → 단일 Task)
```
Source Queue Page URL: https://www.notion.so/abc123
Source Queue Request ID: 42
Split: 1 of 1
```

예시 B (단일 Queue → 3개 Task 분리, 이 Task는 2번째)
```
Source Queue Page URL: https://www.notion.so/abc123
Source Queue Request ID: 42
Split: 2 of 3
```

예시 C (2개 Queue → 단일 Task 묶음)
```
Source Queue Page URL: https://www.notion.so/abc123
Source Queue Request ID: 42
Source Queue Page URL: https://www.notion.so/def456
Source Queue Request ID: 43
Split: 1 of 1
```

예시 D (원본 Queue 없는 R2N 채팅 시작)
```
Source Queue Page URL: (none)
Source Queue Request ID: (none)
Split: 1 of 1
```

### Step 7: SSOT 변경 검토 (ssot_change_review)

- 코딩 전 SSOT 수정 필요 여부 판단
- read-before-write: 변경 대상 SSOT 문서는 수정 전 반드시 fetch해서 현재 내용을 확인

출력
- ssot_change_needed
- ssot_change_reason
- ssot_patch_proposal
- ssot_target_pages

### Step 8: SSOT 변경 제안·승인 (propose_ssot_changes)

- ssot_change_needed == true인 경우에만 실행
- 하드 게이트: SSOT 문서 내용 수정 전에 반드시 user_query로 사용자 승인을 받는다.
- 승인 시: notionUpdatePage(update_content)로 최소 변경 반영
- 거절 시: SSOT 유지, ssot_applied = false

### Step 9: 구현 (implement)

- 구현 시작 시 Queue 항목을 fetch하고, 즉시 "개발 상태"를 "개발 중"으로 변경한다. (락 — 직렬 처리: 락 후 writeback 순서 보장) 단, 이미 "개발 중"인 경우(split Task가 거의 동시에 시작될 때)는 재락하지 않고 그대로 진행한다.
- 이 fetch 결과(기존 개발 기록 포함)를 `queue_snapshot`으로 보관해 Step 10에서 재사용한다.
- SSOT를 단일 진실 공급원으로 취급한다.
- Queue 항목과 SSOT 충돌 시 SSOT 우선, 불일치는 writeback에 기록한다.

### Step 10: Writeback (writeback)

원칙
- 댓글 사용 금지
- 개발 기록 속성(text) 업데이트로 writeback을 수행한다.

절차
1) read-before-write: Step 9에서 저장한 `queue_snapshot`을 재사용해 기존 개발 기록을 확인한다. (추가 fetch 불필요 — Step 9 락과 같은 fetch 결과 공유)
2) 기존 기록이 있으면 보존하고 아래에 추가한다.
3) properties 업데이트 1회로 종료한다.
  - 개발 상태: 개발 완료
  - 개발 기록: fullRecord

(선택) NOTION_EDIT_LOG_DB_URL이 설정되어 있으면, 수정 로그 DB에 작업 로그를 남긴다.

---

## 5. Notion MCP 도구 요약

- notionFetch(id): DB/페이지 읽기 (권장 기본)
- notionSearch(query, data_source_url): 키워드 검색 (빈 쿼리 불가)
- notionQueryDatabaseView(view_url): 뷰 기반 조회 (뷰 URL만)
- notionUpdatePage(page_id, command, ...)
  - update_properties: properties 객체로 속성 업데이트
  - update_content: content_updates 배열로 내용 업데이트 (SSOT 수정은 user_query 승인 필수)

---

## 6. 알려진 문제 및 해결책

- Secrets 값 접근: code_execution에서 직접 접근 불가 → bash로만 읽기
- Notion URL 쿼리 파라미터: `?v=...`, `&source=copy_link` 제거 필요
- notionSearch 제약: 빈 쿼리 불가, filter 미지원 → 결과 속성으로 후보 필터링(개별 fetch 생략), 최종 선택 1건만 상세 fetch
- MCP 응답 빈 값: 비어 있으면 즉시 실패 처리
- URL 보안: 에러 메시지에 URL이 포함되지 않도록 마스킹

---

## 7. 컨벤션

공통 규칙 (N2R · R2N 공통)
- env_vars_first: Step 0 항상 먼저
- bash_for_secrets: Secrets는 bash로만
- clean_url: URL 쿼리 파라미터 제거
- notionFetch_first: DB 조회는 notionFetch 우선
- parallel_fetch: 서로 독립적인 읽기 호출은 병렬 실행 (최대 동시 3건)
- serial_writes: 락·writeback 등 순서가 중요한 쓰기 호출은 직렬 유지 (이유: Step 9 락 → Step 10 writeback 순서 보장)
- session_cache: 한 세션에서 Queue DB collection URL과 후보 페이지 목록은 캐시해 재사용. 사용자가 명시적으로 새로고침을 요청하면 캐시 무효화.
- parse_strict: properties 파싱 실패 시 즉시 중단
- schema_is_contract: 속성 이름·타입은 스킬 정의를 계약으로
- ssot_priority: relation > DB 검색
- ssot_wins: 충돌 시 SSOT 우선
- minimal_ssot_edits: SSOT 수정은 최소 변경
- ssot_hard_gate: SSOT update_content 전 user_query 승인 필수
- read_before_write: 수정 전 fetch
- fail_closed: 기대값 아니면 즉시 중단
- url_as_variable: URL은 변수로만 참조
- disambiguate_results: 검색 결과 2개 이상이면 사용자 선택
- record_via_property: 개발 기록은 text 속성 업데이트로

N2R 전용 규칙
- planning_agent_no_mcp: Planning Agent는 Notion MCP에 직접 연결하지 않는다. Queue 참조만 받아 Task를 생성하고 종료한다.
- task_agent_full_flow: Task Agent는 Task 설명의 `## Notion Queue 참조` 섹션을 파싱해 Step 0부터 전체 흐름을 수행한다.
- single_queue_item: 실행당 Queue 항목 1개
- exclude_in_progress: "개발 중" 제외
- lock_on_start: Step 9에서 즉시 락 (fetch 결과를 queue_snapshot으로 보관); 이미 "개발 중"이면 재락 생략
- include_source_in_writeback: Task 설명의 `## Notion Writeback` 섹션에 원본 Queue Page URL·Request ID·Split 표기를 반드시 포함한다

---

## 변경 로그

- 2026-04-29 [편집] Planning Agent / Task Agent 역할 분리: description 업데이트, `## A. Planning Agent 역할` 섹션(Queue 참조 확인·Task 생성·플랜 템플릿) 추가, `## B. Task Agent 실행 흐름` 진입점 명시, Step 1에 Task 설명 파싱 후 선택 방식 결정 로직 추가, N2R 전용 규칙에 planning_agent_no_mcp·task_agent_full_flow 추가 (Task #222)
- 2026-04-26 [편집] Quick Writeback 원본 Queue 인식: Step 6 Writeback 템플릿에 Source Queue Page URL·Request ID·Split 표기 추가, 예시 A~D 추가, Step 9 락 동작에 "이미 개발 중이면 재락 생략" 명시, N2R 전용 규칙에 include_source_in_writeback·lock_on_start 재락 생략 추가 (Task #126)
- 2026-04-26 [편집] 체감 속도 개선 리팩터: sequential_fetch → parallel_fetch(최대 3건 동시)/serial_writes로 대체, session_cache 컨벤션 추가, Step 1 Path B/A에 캐시 사용 명시, Step 3 SSOT 뷰 결과 캐시 명시, Step 4 병렬 fetch 허용, Step 1 Path A 후보 개별 fetch 제거(최종 선택 1건만 상세 fetch), Step 9 fetch 결과를 queue_snapshot으로 보관해 Step 10 read-before-write와 공유 (Task #119)
- 2026-04-26 [편집] 뷰 기반 빠른 조회 도입: NOTION_QUEUE_VIEW_URL / NOTION_SSOT_VIEW_URL 시크릿 추가, Step 0 확인 키 확장, Step 1 우선순위 B→A→C로 변경, Step 3 SSOT 뷰 폴백 가이드 추가 (Task #118)
- 2026-04-25 [편집] Step 6에 Quick Writeback 단계 포함 의무화 추가 (Task #104)
- 2026-03-27 [편집] 코드 블록 과다 사용 제거, SKILL 본문을 단일 code block으로 통합
