---
name: Notion2Replit
description: Planning Agent가 사용자로부터 Notion Queue 참조(requestId / pageUrl / 자동선택)를 받아 Task를 생성하는 스킬. Planning Agent는 Notion에 직접 연결하지 않고 Task만 생성하며, 실제 MCP 연결·구현·writeback은 Task Agent가 수행한다.
---

# Queue DB → Plan → Dev → Writeback

Notion Queue DB의 작업 항목을 SSOT Docs DB 문서와 함께 해석해 개발
작업으로 전환하는 흐름이다.

## A. Planning Agent 역할

Planning Agent는 이 섹션만 수행하며 Notion MCP에 직접 연결하거나
구현하지 않는다.

1. 사용자 요청에서 다음 중 하나를 확인한다.
   - `requestId`: 예) "42번 Queue 처리해줘"
   - `pageUrl`: Notion 페이지 URL
   - 자동선택: 명시한 참조가 없는 경우
2. 참조가 불명확하면 요청 ID, 페이지 URL, 또는 자동선택 여부 중 하나를
   사용자에게 질문한다.
3. 다음 형식의 Task를 생성하고 종료한다.

```markdown
## Notion Queue 참조

선택 방식: <requestId | pageUrl | 자동선택>
Request ID: <숫자, 없으면 (none)>
Page URL: <URL, 없으면 (none)>

## 수행 지침

Task Agent는 Notion2Replit 스킬의 `## B. Task Agent 실행 흐름`에 따라
Step 0부터 실행한다.

## Notion Writeback

구현 완료 후 Replit2Notion 스킬의 Quick Writeback 절차에 따라 원본 Queue
페이지를 업데이트한다.

Source Queue Page URL: <확정 뒤 채움>
Source Queue Request ID: <확정 뒤 채움>
Split: 1 of 1
```

## B. Task Agent 실행 흐름

Task 설명의 `## Notion Queue 참조`에서 선택 방식, 요청 ID, 페이지 URL을
읽고 다음 절차를 수행한다.

### Step 0: 환경 확인

- `NOTION_QUEUE_DB_URL`, `NOTION_SSOT_DB_URL`과 선택적
  `NOTION_EDIT_LOG_DB_URL`, `NOTION_QUEUE_VIEW_URL`,
  `NOTION_SSOT_VIEW_URL`의 존재를 확인한다.
- 실제 Secret 값은 채팅이나 로그에 노출하지 않는다.
- Notion URL은 쿼리 문자열을 제거해 정제한다.

### Step 1–2: Queue 항목 선택 및 로드

- requestId나 pageUrl이 있으면 해당 항목을 직접 선택한다.
- 자동선택이면 Queue 뷰가 있을 때 `notionQueryDatabaseView`를 먼저
  사용하고, 없거나 실패하면 `notionFetch`와 `notionSearch`로 폴백한다.
- "개발 전" 항목만 유효 후보로 취급하고 "개발 중" 항목은 제외한다.
- 후보가 둘 이상이면 사용자에게 선택을 요청한다.
- 최종 항목을 fetch해 속성을 엄격히 파싱한다.

### Step 3–5: SSOT 해석 및 요구사항 추출

- Queue의 "영향 문서" relation을 SSOT 문서의 첫 근거로 사용한다.
- relation이 없을 때만 SSOT 뷰 또는 유형/키워드 검색으로 보조 후보를
  찾는다.
- 독립 문서는 최대 3개씩 병렬로 fetch한다.
- Queue와 SSOT가 충돌하면 SSOT를 우선한다.
- 요청 제목, 개발 기록, 제약, 영향 범위, 참조 문서를 추출한다.

### Step 6: 구현 계획

- `.local/session_plan.md`에 개요, 작업 분해, 변경 파일, 테스트 계획,
  위험을 적는다.
- 마지막 단계에는 원본 Queue URL, 요청 ID, Split 정보를 포함한
  `## Notion Writeback`을 반드시 둔다.

### Step 7–8: SSOT 변경 검토

- 변경이 필요하면 먼저 현재 문서를 읽고 최소 변경안을 제안한다.
- SSOT 본문을 수정하기 전에는 반드시 사용자 승인을 받는다.
- 승인된 경우에만 `notionUpdatePage(update_content)`로 반영한다.

### Step 9: 구현

- Queue 항목을 다시 fetch한 뒤 "개발 상태"를 "개발 중"으로 잠근다.
- 이미 "개발 중"이면 재락하지 않는다.
- 이 fetch 결과는 `queue_snapshot`으로 보관해 writeback에 재사용한다.
- 구현, 검증, Task 완료 절차를 수행한다.

### Step 10: Writeback

- 댓글 대신 Queue의 "개발 기록" text 속성을 한 번 업데이트한다.
- Step 9의 `queue_snapshot`을 재사용해 기존 기록을 보존하고 결과를
  덧붙인다.
- "개발 상태"를 "개발 완료"로 설정한다.

## 공통 규칙

- 읽기 전에는 쓰지 않는다. 예상하지 못한 응답은 조용히 폴백하지 말고
  실패 처리한다.
- 독립 읽기는 병렬로, 잠금·writeback 등 순서 의존 쓰기는 직렬로 처리한다.
- URL은 변수로만 다루고 오류 메시지에서 마스킹한다.
- 실행당 Queue 항목은 하나만 처리한다.
- 원본 Queue URL·Request ID·Split은 Task 설명과 writeback에 보존한다.