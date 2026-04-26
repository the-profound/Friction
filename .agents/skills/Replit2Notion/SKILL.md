---
name: Replit2Notion
description: 채팅으로 요청받은 개발 작업을 완료한 뒤, 그 결과를 Notion Queue DB에 새 항목으로 생성하고 필요 시 SSOT Docs DB를 수정하는 역방향 워크플로우. 사용자가 "이 작업 Queue에 기록해줘", "개발 완료 내용 Notion에 올려줘", "Queue DB에 등록하고 SSOT도 업데이트해줘" 같은 요청을 할 때 사용.
---

# Chat → Dev → Queue DB 생성 + SSOT 수정

채팅으로 요청받아 개발을 완료한 뒤, 그 결과를 Queue DB에 새 항목으로 생성하고,
구현 내용이 기존 SSOT 문서와 불일치하면 SSOT를 최소 변경으로 수정한다.

기존 Notion2Replit 스킬의 역방향 흐름이다.

---

## 1. 언제 사용하는가

- 채팅으로 개발 요청을 받아 구현을 완료한 뒤, 그 내용을 Queue DB에 기록해야 할 때
- 개발 완료 후 SSOT 문서에 반영이 필요한 변경이 있을 때
- Queue DB에 작업 이력을 남기고 SSOT 정합성을 유지하고 싶을 때

---

## 2. 사전 조건

- (선택) Notion 수정 로그 DB: Replit이 Notion을 수정한 내역을 남기는 DB
- Notion MCP: `.local/mcp_skills/notion_mcp_server/SKILL.md` 참고, 연결·인증 완료
- Replit Secrets
  - `NOTION_QUEUE_DB_URL`: Queue DB Notion URL
  - `NOTION_SSOT_DB_URL`: SSOT Docs DB Notion URL
  - (선택) `NOTION_EDIT_LOG_DB_URL`: Replit → Notion 수정 로그 DB URL

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
- 요청 처리 시: (요청 페이지 → 영향 문서 목록)을 기준으로 어떤 문서를 업데이트해야 하는지 결정한다.

---

## 4. 워크플로우 (Step 0 ~ Step 7)

### Step 0: 환경 변수 확인 (check_env_vars)

- (선택) 수정 로그 DB를 남기려면 NOTION_EDIT_LOG_DB_URL도 확인
- 항상 가장 먼저 수행한다.
- 확인 키: NOTION_QUEUE_DB_URL, NOTION_SSOT_DB_URL, NOTION_EDIT_LOG_DB_URL
- Secrets 실제 값은 bash로만 읽는다.
- Notion URL은 `?v=...`, `&source=copy_link` 등을 제거해 정제한다.

정제 함수 (필요 최소)
- cleanNotionUrl(url): url에서 `?` 이후 제거
- maskDomain 옵션이 필요하면 에러 로그에서 도메인 마스킹 적용

### Step 1: Queue DB 구조 조회 (fetch_queue_db_schema)

목적
- Queue DB의 data_source_id 확보 (페이지 생성에 필요)

원칙
- DB는 먼저 fetch해서 collection URL/ID를 추출한다.
- 추출 실패 시: NOTION_QUEUE_DB_URL 재확인을 요청하고 중단한다.

출력
- queueDataSourceId

### Step 2: 개발 내용 수집 (collect_dev_context)

현재 세션 컨텍스트에서 아래를 수집한다.
- request_title: 사용자 요청 한 줄 요약
- dev_record: 아래 형식을 그대로 사용해 작성 (레이블·순서 고정)
- files_changed: 수정된 파일 목록
- change_summary: 변경사항 요약 bullet
- how_to_test: 테스트 방법

개발 기록(dev_record)은 아래 레이블 형식을 **그대로** 사용해 작성한다.
레이블 뒤에 콜론(:)과 공백 한 칸을 쓰고, 값을 이어서 작성한다.
항목이 여러 줄이면 레이블 아래에 들여쓰기 없이 bullet(-)으로 나열한다.

```
- 완료 일시:
- 구현 요약(핵심 2~5줄):
- 수정 파일/영역:
- 테스트 방법:
- 비고(있으면):
```

규칙
- 레이블 이름·순서는 변경하지 않는다.
- 값이 없는 항목은 비워두지 않고 "없음"으로 채운다. 단, "비고(있으면):"는 내용이 없으면 항목 자체를 생략해도 된다.
- 완료 일시는 반드시 KST 기준 실제 시각을 기입한다.

### Step 3: Queue DB 항목 생성 (create_queue_item)

- notionCreatePages로 새 항목을 생성한다.
- 기본값
  - 개발 상태: 개발 완료
  - 개발 기록: dev_record

출력
- queue_page_url 또는 queue_page_id

### Step 4: 생성 확인 (verify_created_item)

- read-before-write: 생성된 항목을 다시 fetch해서 속성이 정확히 기록되었는지 확인한다.
- 필수 검증
  - 요청 제목 존재
  - 개발 기록 존재

### Step 5: SSOT 변경 필요 여부 판단 (ssot_change_review)

구현 내용이 기존 SSOT 문서와 불일치하는지 검토한다.
판단 기준 예시
- 새로운 화면 추가 여부
- 기존 컴포넌트 동작 변경 여부
- 데이터 모델/API 변경 여부
- SSOT 기술과 실제 구현 불일치 여부

관련 SSOT 문서는 키워드 검색으로 찾는다.
- 결과가 2개 이상이면 사용자에게 목록을 보여주고 선택을 받는다.

출력
- ssot_change_needed
- ssot_change_reason
- ssot_patch_proposal
- ssot_target_pages

### Step 6: SSOT 변경 제안·승인·반영 (propose_ssot_changes)

- ssot_change_needed == true인 경우에만 실행
- 하드 게이트: SSOT 문서 내용 수정 전에 반드시 user_query로 사용자 승인을 받는다.

승인 시
- SSOT 문서를 update_content로 최소 변경 반영
- Queue 항목에 "영향 문서" relation 연결
- Queue 항목의 개발 기록에 SSOT 수정 로그를 추가

거절 시
- SSOT는 유지
- (식별된 경우) Queue 항목의 "영향 문서" relation만 설정

### Step 7: 완료 보고 (summary)

사용자에게 아래를 보고한다.
- Queue DB 생성 결과 (페이지 URL, 속성 요약)
- SSOT 수정 여부 및 결과
- 전체 작업 요약

(선택) NOTION_EDIT_LOG_DB_URL이 설정되어 있으면 수정 로그 DB에 남긴다.

---

## 5. Notion MCP 도구 요약

- notionFetch(id): DB/페이지 읽기 (권장 기본)
- notionSearch(query, data_source_url): 키워드 검색 (빈 쿼리 불가)
- notionCreatePages(parent.data_source_id, pages): DB에 페이지 생성
- notionUpdatePage(page_id, command, ...)
  - update_properties: properties 객체로 속성 업데이트
  - update_content: content_updates 배열로 내용 업데이트 (SSOT 수정은 user_query 승인 필수)

---

## 6. 알려진 문제 및 해결책

- Secrets 값 접근: code_execution에서 직접 접근 불가 → bash로만 읽기
- Notion URL 쿼리 파라미터: `?v=...`, `&source=copy_link` 제거 필요
- notionSearch 제약: 빈 쿼리 불가, filter 미지원 → 결과 속성으로 후보 필터링 후 개별 fetch 최소화
- Properties 파싱: 파싱 실패 시 명시적 에러
- notionUpdatePage 파라미터: update_content는 content_updates, update_properties는 properties
- notionCreatePages: database_id가 아니라 data_source_id 필요
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
- serial_writes: 락·writeback 등 순서가 중요한 쓰기 호출은 직렬 유지
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

R2N 전용 규칙
- create_with_record: Queue 페이지 생성 시 개발 기록 포함
- data_source_id_for_create: parent는 data_source_id
- verify_after_create: 생성 후 fetch로 확인
- update_source_when_known: 원본 Queue 식별자(Source Queue Page URL)가 있으면 신규 생성하지 않고 원본 페이지를 업데이트한다
- last_split_completes: `Split: i of N`에서 `i == N`인 Task만 원본 Queue의 "개발 상태"를 "개발 완료"로 세팅한다. 나머지는 "개발 중"으로 유지한다

---

## 8. Task 에이전트용 Quick Writeback 절차

Task 에이전트가 구현을 완료한 뒤 사용자 개입 없이 Notion Queue DB에 완료 기록만 남기는 경량 절차이다.
SSOT 수정 판단(Step 5~6)은 생략한다.

### 언제 사용하는가

- Task 에이전트가 할당된 구현 작업을 마치고 `mark_task_complete`를 호출하기 직전

### Quick Writeback 흐름 (QW-Step 0 ~ QW-Step 4)

**QW-Step 0: 환경 변수 확인**
- bash로 `NOTION_QUEUE_DB_URL` 값을 읽는다.
- 값이 없으면 writeback을 건너뛰고, `.local/tasks/evidence/qw-<taskRef>-skipped.md`에 "NOTION_QUEUE_DB_URL 미설정으로 건너뜀" 사유를 기록한다.

**QW-Step 1: Queue DB 구조 조회**
- `notionFetch`로 Queue DB를 조회해 `queueDataSourceId`를 확보한다.
- 실패 시 writeback을 건너뛰고, `.local/tasks/evidence/qw-<taskRef>-skipped.md`에 실패 사유를 기록한다.

**QW-Step 1.5: 원본 Queue 식별자 파싱**
- 현재 Task 설명의 `## Notion Writeback` 섹션에서 아래 줄을 파싱한다.
  - `Source Queue Page URL:` — 원본 Queue 페이지 URL (복수 줄 가능)
  - `Source Queue Request ID:` — 원본 Queue 요청 ID (Page URL과 짝으로 복수 줄 가능)
  - `Split: i of N` — 분리 순서 (없으면 단일 Task로 취급, i=1, N=1)
- 파싱 규칙
  - `Source Queue Page URL: (none)` 이면 폴백(신규 생성) 경로임을 확정하고 QW-Step 3-B로 이동한다.
  - URL이 유효한 값이면 QW-Step 3-A(원본 페이지 업데이트)로 이동한다.
  - `## Notion Writeback` 섹션 자체가 없거나 파싱 실패(필수 줄 누락 등)는 **명시적 에러**로 처리한다. 조용한 폴백 불가. `.local/tasks/evidence/qw-<taskRef>-skipped.md`에 파싱 실패 사유를 기록하고 중단한다.

**QW-Step 2: 개발 내용 수집**
- 현재 세션 컨텍스트에서 아래 항목을 작성한다.
  ```
  - 완료 일시: (KST 실제 시각)
  - 구현 요약(핵심 2~5줄):
  - 수정 파일/영역:
  - 테스트 방법:
  - 비고(있으면):
  ```
- `request_title`: Task 제목 한 줄 요약
- `task_ref_header`: `### [Task #<ref>] <request_title> — <완료 일시 KST>` 형식의 헤더 문자열. append 블록의 첫 줄에 사용한다.

**QW-Step 3-A: 원본 Queue 페이지 업데이트** (Source Queue Page URL이 유효한 경우)

원본 페이지가 여러 개(다수 Queue → 단일 Task 묶음)면 각 페이지에 대해 아래를 순서대로 실행한다.

1. read-before-write: 원본 Queue 페이지를 `notionFetch`로 읽어 기존 "개발 기록" 텍스트를 확보한다.
2. 멱등성 체크: 기존 "개발 기록"에 이번 `task_ref_header`와 동일한 줄이 이미 존재하면 해당 블록만 교체하고 새로 추가하지 않는다(재실행 안전).
3. 없으면 기존 "개발 기록" 뒤에 아래를 append한다.
   ```
   <task_ref_header>
   <QW-Step 2의 dev_record>
   ```
4. 상태 결정 (`Split: i of N` 기준)
   - `i == N` 이거나 Split 표기가 없으면(단일): 개발 상태 = "개발 완료"
   - `i < N` 이면: 개발 상태 = "개발 중"
5. `notionUpdatePage(update_properties)`로 아래를 1회 업데이트한다.
   - 개발 기록: 위에서 조합한 fullRecord
   - 개발 상태: 위 규칙대로 결정된 값

**QW-Step 3-B: 신규 Queue 페이지 생성** (Source Queue Page URL이 `(none)`인 경우)
- `notionCreatePages`로 새 항목을 생성한다.
- 기본값: 개발 상태 = "개발 완료", 개발 기록 = QW-Step 2의 dev_record

**QW-Step 4: 검증 및 기록**
- QW-Step 3-A(업데이트) 경로: 원본 페이지를 `notionFetch`로 읽어 아래를 확인한다.
  - (a) 이번 `task_ref_header`가 "개발 기록"에 포함되어 있는지
  - (b) "개발 상태"가 위 규칙대로 설정되었는지
  - 확인 성공 시 `.local/tasks/evidence/qw-<taskRef>-done.md`에 원본 Queue 페이지 ID, 요청 제목, 적용된 개발 상태, Split 정보를 기록한다.
- QW-Step 3-B(신규 생성) 경로: 생성된 항목을 `notionFetch`로 읽어 요청 제목과 개발 기록이 존재하는지 확인한다.
  - 확인 성공 시 `.local/tasks/evidence/qw-<taskRef>-done.md`에 Queue 페이지 ID와 요청 제목을 기록한다.

### 동시성·멱등성 가이드

- 각 Task의 append 블록은 `### [Task #ref] 제목 — 완료 시각` 형식의 고유 헤더로 시작한다.
- 같은 Task ref 헤더가 이미 "개발 기록"에 존재하면 새로 추가하지 않고 해당 블록만 교체한다(재실행 안전).
- 상태 세팅("개발 완료" / "개발 중")은 마지막 쓰기가 이기는 idempotent 동작이다.
- 분산 락은 구현하지 않는다. read-before-write append와 Task ref 헤더 체크로 best-effort 처리한다.

### Quick Writeback 전용 규칙

- **no_ssot_in_quick**: SSOT 문서 수정·판단·검토를 일절 수행하지 않는다.
- **no_user_approval**: 사용자 승인(user_query) 없이 바로 실행한다.
- **skip_on_error**: 환경 변수 누락·네트워크 오류 등으로 실패하더라도 Task 완료를 막지 않는다. 실패 사유는 `.local/tasks/evidence/qw-<taskRef>-skipped.md`에 기록한다. 단, QW-Step 1.5 파싱 실패는 명시적 에러로 기록 후 중단한다(skip_on_error의 예외).
- **update_source_when_known**: 원본 Queue 식별자(Source Queue Page URL)가 있으면 신규 생성하지 않고 원본 페이지를 업데이트한다.
- **last_split_completes**: `Split: i of N`에서 `i == N`인 Task만 원본 Queue의 "개발 상태"를 "개발 완료"로 변경한다. 나머지는 "개발 중"으로 유지한다.
- 그 외 공통 규칙(env_vars_first, bash_for_secrets, clean_url, read_before_write 등)은 동일하게 적용한다.

---

## 변경 로그

- 2026-04-26 [편집] Quick Writeback 원본 Queue 인식: QW-Step 1.5(소스 식별자 파싱) 추가, QW-Step 3을 3-A(원본 업데이트)/3-B(신규 생성 폴백)으로 분리, QW-Step 4 검증 강화, 동시성·멱등성 가이드 추가, R2N 컨벤션에 update_source_when_known·last_split_completes 추가 (Task #126)
- 2026-04-26 [편집] 체감 속도 개선 리팩터: sequential_fetch → parallel_fetch(최대 3건 동시)/serial_writes로 대체, session_cache 컨벤션 추가 (Task #119)
- 2026-04-25 [추가] Task 에이전트용 Quick Writeback 절차 (Section 8) 추가
- 2026-03-27 [편집] 코드 블록 과다 사용 제거, SKILL 본문을 단일 code block으로 통합