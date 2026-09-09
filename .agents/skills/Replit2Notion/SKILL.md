---
name: Replit2Notion
description: UTF-8 Markdown 명세서 파일을 안전하고 멱등적으로 Notion 데이터베이스에 게시하는 절차와 실행 계약.
---

# 파일 기반 Markdown 명세서 → Notion 게시

작업 결과로 생성된 Markdown 명세서 파일을 읽어 Notion 데이터베이스에 한 번에
게시한다. 파일 해석·제목 추출·Markdown 블록 변환·해시 계산은 로컬에서
결정론적으로 수행하고, Notion 연결은 얇은 전송 계층으로만 사용한다.

이 SKILL은 **파일 기반 명세서 게시만 담당한다.** 기존의 Notion Queue 항목
선택, Queue → Replit 개발 계획 수립, SSOT 문서 해석·수정, 기존 Queue
페이지 Quick Writeback 절차는 제거되었으며 이 문서에서 지원하지 않는다.

## 1. 사용 시점

- 완료된 작업의 Markdown 명세서 전체를 별도 Notion DB 페이지로 보존할 때
- 같은 명세서를 재실행해도 중복 페이지를 만들지 않아야 할 때
- Notion DB마다 속성 이름이 다른 경우 명시적 속성 매핑으로 게시할 때

다음 목적에는 이 SKILL을 사용하지 않는다.

- Notion Queue에서 개발 항목을 읽어 작업을 시작하는 흐름
- 기존 Queue 페이지의 상태·개발 기록을 갱신하는 흐름
- SSOT 문서의 내용을 자동으로 변경하는 흐름
- 파일 내용을 요약하거나 LLM으로 다시 작성하는 흐름

## 2. 안전 원칙

- Notion 인증 정보는 Replit에 연결된 Notion 커넥터/MCP에서만 얻는다.
- 토큰·본문·전체 DB URL을 소스, CLI 인자, 로그, 오류에 기록하지 않는다.
- DB 속성을 새로 만들거나 기존 데이터를 일괄 정리하지 않는다.
- DB URL은 환경변수 또는 함수 옵션으로 받고, 실행 로그에는 페이지 URL과
  제한된 요약 메타데이터만 출력한다.
- 원본 Queue 페이지 URL이 전달되면 새 페이지를 만들지 않고 즉시 중단한다.
  기존 Queue 업데이트는 이 SKILL의 책임이 아니므로 별도 절차를 사용해야 한다.
- 운영 DB에 대한 실제 쓰기 검증은 별도 비운영 테스트 DB가 제공된 경우에만
  수행한다.

## 3. 입력 계약

구현은 `scripts/src/notion-publisher/publisher.ts`의
`publishMarkdownFile(transport, options)`을 사용한다.

필수 입력:

- `filePath`: UTF-8 Markdown 파일 경로
- `databaseUrl` 또는 `databaseUrlEnv`: 대상 DB URL. 기본 환경변수는
  `NOTION_QUEUE_DB_URL`이다.

선택 입력:

- `title`: 지정하면 첫 제목 대신 페이지 제목으로 사용
- `status`: 대상 DB의 상태 속성 값
- `mapping`: 대상 DB 속성 매핑
- `sourceQueuePageUrl`: 실제 URL이면 중복 게시 방지를 위해 fail-closed

기본 Queue 매핑:

- `요청 제목`: `title`
- `개발 상태`: `status`
- `개발 기록`: `body`

다른 DB는 예를 들어 다음처럼 명시한다.

```json
{
  "title": "문서 이름",
  "status": "작성 상태",
  "body": "게시 식별자",
  "documentKey": "문서 키",
  "contentHash": "내용 해시"
}
```

멱등성 조회를 위해 `body` 또는 `documentKey`와 `contentHash` 조합 중 하나가
필수다. 대상 DB에 해당 속성이 실제로 존재하고 타입이 일치하는지 먼저
검증한다.

## 4. 표준 실행 절차

### Step 0: 대상과 인증 확인

1. `databaseUrl` 또는 지정된 환경변수를 확인한다.
2. URL에서 쿼리·fragment를 제거하고 HTTPS Notion URL인지 검증한다.
3. Secret 값을 출력하거나 채팅·파일에 복사하지 않는다.
4. 인증은 Replit Notion 연결/MCP 전송 어댑터를 통해서만 수행한다.
   Replit Notion 커넥터 프록시가 호환되는 `Notion-Version` 헤더를 주입하므로
   어댑터에서 해당 헤더를 직접 설정하지 않는다.

### Step 1: 파일을 한 번 읽고 검증

1. 파일을 UTF-8로 한 번 읽는다.
2. 파일 없음·읽기 실패·빈 파일을 명확한 다음 조치와 함께 반환한다.
3. `--title`이 없으면 첫 번째 Markdown 제목을 페이지 제목으로 사용한다.
4. 제목은 Notion rich-text 제한인 2,000자 이하여야 한다. 초과하면 쓰기
   전에 중단한다.

파일 본문은 콘솔이나 에이전트 컨텍스트에 출력하지 않는다.

### Step 2: 로컬 변환

LLM 호출 없이 아래 규칙으로 변환한다.

- `#`, `##`, `###` 제목 → Notion `heading_1`, `heading_2`, `heading_3`
- `-`, `*`, `+` 목록 → `bulleted_list_item`
- 숫자 목록 → `numbered_list_item`
- fenced code block → `code`
- 나머지 일반 문단 → `paragraph`
- 빈 줄 → 문단 경계

각 rich-text 조각은 2,000자 이하로 줄 단위·공백 우선 분할한다.
`ts`, `tsx`, `js`, `jsx` 등 흔한 코드 언어 별칭은 Notion 언어명으로
정규화하고 알 수 없는 언어는 `plain text`로 게시한다.
블록은 요청당 최대 100개 배치로 만든다.

### Step 3: DB 스키마 조회

1. `notionFetch` 또는 커넥터 API로 DB의 data source/database 식별자와
   필요한 속성 이름·타입만 읽는다.
2. 속성 매핑이 스키마 계약과 다르면 게시하지 않고 원인과 수정할 매핑을
   반환한다.
3. 같은 프로세스의 같은 전송 계층에서는 스키마 조회 결과를 캐시한다.

DB 속성을 자동 생성하지 않는다.

### Step 4: 멱등성 조회

문서 키는 정제된 DB URL과 canonical file path를 SHA-256으로 계산한 안정적인
값이다. 파일 내용은 별도의 SHA-256 해시로 계산한다. 제목·상태·매핑까지
포함한 desired-state hash를 최종 게시 식별자로 사용한다.

1. 현재 프로세스 캐시에 검증된 페이지 메타데이터가 있으면 먼저 비교한다.
2. 캐시가 없으면 문서 키 속성 또는 본문 식별 마커로 기존 페이지를 조회한다.
3. 기존 페이지의 최종 desired-state hash가 같으면 `unchanged`로 즉시 종료한다.
   이 경로에서는 쓰기와 후속 본문 조회를 하지 않는다.
4. 제목·상태·매핑이 달라졌으면 같은 페이지를 갱신한다.

같은 문서 키가 여러 페이지에 존재하면 중복을 조용히 선택하지 말고 중단한다.

### Step 5: 게시

1. 첫 블록 배치와 속성을 생성 또는 갱신한다.
2. 처음에는 `pending-...` 식별자를 저장한다.
3. 나머지 블록 배치를 최대 100개씩 순서대로 추가한다.
4. 모든 본문 배치가 성공한 뒤에만 최종 desired-state hash를 저장한다.
5. 중간 실패가 발생하면 다음 실행이 pending 식별자를 완료로 오인하지 않고
   기존 페이지를 복구하도록 한다.

페이지 갱신 시 기존 본문을 대체해야 하며, 이전 본문 뒤에 새 본문을
무조건 덧붙여 중복시키지 않는다.

### Step 6: 최소 검증

게시 후 제목, 지정된 상태, 문서 키/최종 해시 식별자만 다시 읽는다.
검증 결과가 기대값과 다르면 실패로 반환한다. 본문 전체를 다시 모델
컨텍스트나 로그로 가져오지 않는다.

성공 결과에는 다음 제한된 메타데이터만 포함한다.

- `created`, `updated`, `unchanged` 중 action
- 생성·갱신된 Notion 페이지 URL
- 제목
- 상태
- 블록 수
- 실제 API 요청 수 또는 논리적 전송 호출 수
- 해시 prefix

## 5. CLI

기본 CLI는 설치된 Replit Notion 커넥터를 사용한다.

```sh
pnpm --filter @workspace/scripts notion:publish -- \
  --file .local/tasks/example.md \
  --database-url-env NOTION_QUEUE_DB_URL \
  --status "개발 완료"
```

MCP 호스트가 제공하는 별도 전송 어댑터가 필요하면
`--adapter /absolute/path/to/adapter.ts`를 추가한다. 어댑터는
`createNotionTransport`를 export하고 `NotionTransport` 계약을 구현해야 한다.
어댑터 초기화 오류도 안전한 고정 메시지로 마스킹한다.

실행 결과는 페이지 URL과 제한된 메타데이터만 JSON으로 출력한다. 오류에는
파일 경로의 상세 내용, 파일 본문, 토큰, 전체 DB URL, 원격 응답 본문을
포함하지 않는다.

## 6. 전송 어댑터 계약

`NotionTransport`는 다음을 제공한다.

- `fetchDatabase`: 식별자와 필요한 속성 타입 조회
- `findByDocumentKey`: 문서 키와 최종 해시를 가진 페이지 조회
- `createPage`: 첫 블록 배치와 pending 속성으로 페이지 생성
- `updatePage`: 속성 갱신 및 기존 본문 대체
- `appendBlocks`: 최대 100개 블록 추가
- `finalizePage`: 모든 본문 쓰기 후 최종 해시 저장
- `verifyPage`: 제목·상태·식별자 최소 검증
- 선택적 `getRequestCount`: 실제 HTTP 요청 계측

기본 구현은 `scripts/src/notion-publisher/connector-adapter.ts`에 있다.
Replit 커넥터 SDK의 인증·토큰 갱신을 직접 재구현하거나 캐시하지 않는다.

## 7. 오류 처리

| 상황 | 처리 |
| --- | --- |
| 파일 없음/읽기 실패 | 파일 경로와 UTF-8 여부를 확인하라는 메시지 |
| 빈 파일 | 게시할 Markdown을 추가하라는 메시지 |
| 제목 없음 | `--title` 지정 안내 |
| 제목 2,000자 초과 | 더 짧은 제목 지정 안내 |
| DB URL 없음/형식 오류 | 환경변수 또는 Notion 공유 URL 확인 안내 |
| 속성 매핑 불일치 | 필요한 속성 이름·타입 수정 안내 |
| 중복 문서 키 | 중복 페이지를 수동 확인하라는 메시지 |
| 인증·권한·Notion API 실패 | 연결, 페이지 공유 범위, API 상태 확인 안내 |
| 게시 후 검증 실패 | 페이지의 제목·상태·식별자 확인 안내 |

원격 오류의 원문 응답과 요청 본문은 사용자 출력에 전달하지 않는다.

## 8. 검증 명령

실제 Notion 쓰기 없이 다음 명령으로 로컬 동작을 검증한다.

```sh
pnpm --filter @workspace/scripts test:notion-publisher
pnpm --filter @workspace/scripts typecheck
```

별도 비운영 Notion DB가 있을 때만 생성 → 동일 파일 재실행 → 변경 파일
갱신 순서의 실제 커넥터 검증을 추가한다. 운영 Queue DB를 테스트 대상으로
사용하지 않는다.

## 9. 관련 구현 문서

- 실행 계약과 사용 예시: `scripts/src/notion-publisher/README.md`
- 순수 변환·해시·매핑: `scripts/src/notion-publisher/core.ts`
- 게시 오케스트레이션: `scripts/src/notion-publisher/publisher.ts`
- Replit Notion 커넥터: `scripts/src/notion-publisher/connector-adapter.ts`
- 로컬 단위 테스트: `scripts/src/notion-publisher/core.test.ts`