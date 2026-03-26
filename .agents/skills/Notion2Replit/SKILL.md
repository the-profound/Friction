---
name: Notion2Replit
description: Notion Queue DB에서 작업 항목을 선택하고 SSOT Docs DB의 관련 문서를 해석하여 Replit에서 구현한 뒤 결과를 Queue 항목에 writeback하는 전체 개발 워크플로우. 사용자가 "Queue 작업을 처리해줘", "Queue에서 개발 항목 골라서 구현해줘", "Queue DB → 개발 → Notion 업데이트" 같은 요청을 할 때 사용.
---

# Queue DB → Plan → Dev → Writeback

Notion Queue DB에서 작업 항목 하나를 선택하고, SSOT Docs DB에서 관련 문서를 해석하여 구현 계획을 수립한다.
필요 시 SSOT 문서 수정을 제안·승인·반영한 뒤 코드를 구현하고, 완료 결과를 Queue 항목에 다시 기록(writeback)한다.

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
- 확인 키: NOTION_QUEUE_DB_URL, NOTION_SSOT_DB_URL, NOTION_EDIT_LOG_DB_URL
- Secrets 실제 값은 bash로만 읽는다.
- Notion URL은 `?v=...`, `&source=copy_link` 등을 제거해 정제한다.

정제 함수 (필요 최소)
- cleanNotionUrl(url): url에서 `?` 이후 제거
- maskDomain 옵션이 필요하면 에러 로그에서 도메인 마스킹 적용

### Step 1: Queue 항목 선택 (pick_queue_item)

우선순위: A → B → C

A) notionFetch + notionSearch (권장)
- Queue DB를 fetch해서 collection URL을 얻는다.
- 상태값(예: "개발 전")을 키워드로 search한다. (빈 쿼리 금지)
- 각 후보 페이지를 notionFetch로 로드해 속성을 검증한다.
  - "개발 중"은 제외
  - "개발 전"만 선택
- 후보가 2개 이상이면 사용자에게 목록을 보여주고 선택을 받는다.
- 후보가 0개면 처리 가능한 항목이 없다고 알리고 중단한다.

B) notionQueryDatabaseView
- 정제된 뷰 URL이 있을 때만 사용
- 실패 시 A로 전환

C) requestId / pageUrl 직접 지정

출력
- queue_item_page_url, queue_item_properties

### Step 2: Queue 항목 로드 (load_queue_item)

- queue_item_page_url을 fetch하여 properties를 파싱한다.
- properties 파싱 실패 시 명시적으로 에러 처리한다. (조용한 폴백 금지)

### Step 3: SSOT 문서 해석 (resolve_ssot_docs)

우선순위
1) Queue 항목의 "영향 문서" relation
2) relation이 비었으면 유형 매핑 + 키워드 검색

출력
- ssot_doc_page_urls

### Step 4: SSOT 문서 로드 (load_ssot_docs)

- Promise.all 금지 (순차 fetch)
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

- 구현 시작 시 즉시 Queue 항목 "개발 상태"를 "개발 중"으로 변경한다. (락)
- SSOT를 단일 진실 공급원으로 취급한다.
- Queue 항목과 SSOT 충돌 시 SSOT 우선, 불일치는 writeback에 기록한다.

### Step 10: Writeback (writeback)

원칙
- 댓글 사용 금지
- 개발 기록 속성(text) 업데이트로 writeback을 수행한다.

절차
1) read-before-write: Queue 항목을 fetch해서 기존 개발 기록을 확인한다.
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
- notionSearch 제약: 빈 쿼리 불가, filter 미지원 → 결과를 개별 fetch로 검증
- MCP 응답 빈 값: 비어 있으면 즉시 실패 처리
- URL 보안: 에러 메시지에 URL이 포함되지 않도록 마스킹

---

## 7. 컨벤션

공통 규칙 (N2R · R2N 공통)
- env_vars_first: Step 0 항상 먼저
- bash_for_secrets: Secrets는 bash로만
- clean_url: URL 쿼리 파라미터 제거
- notionFetch_first: DB 조회는 notionFetch 우선
- sequential_fetch: 여러 페이지는 순차 fetch
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
- single_queue_item: 실행당 Queue 항목 1개
- exclude_in_progress: "개발 중" 제외
- lock_on_start: Step 9에서 즉시 락

---

## 변경 로그

- 2026-03-27 [편집] 코드 블록 과다 사용 제거, SKILL 본문을 단일 code block으로 통합