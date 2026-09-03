# Friction 운영 관측성과 장애 대응 런북

## 개인정보 경계

운영 로그와 모바일 운영 이벤트에는 요청 ID, 작업 종류, 결과, 지연, HTTP 상태,
릴리스 트랙, 플랫폼, 앱/빌드 버전, 제한된 실패 유형만 남긴다. 인증 헤더, 쿠키,
토큰, 이메일, 사용자 ID, 편지·메모 본문, 푸시 본문, 원문 예외 메시지와 스택은
남기지 않는다. `x-request-id`는 `req_`로 시작하는 고정 형식만 신뢰하며 그 외 값은
서버가 새로 만든다.

## 공통 조회 키

- API 요청/응답: `event=operational.metric operation=api.request correlationId=<req_...>`
- 예약 생성: `event=operational.scheduled_send_created scheduledSendId=<id>`
- 예약 처리: `operation=scheduler.scheduled-send correlationId=<req_...>`
- 인증: `operation=auth.verify`
- DB/readiness: `operation=db.readiness`
- 스토리지: `operation=storage.inline-upload|storage.signed-url|storage.download`
- 푸시: `operation=push.send|scheduler.letter-push`
- 모바일 API/렌더 오류: PostHog의 `api_request`, `client_exception`

모바일에서 보이는 요청 ID로 API 로그를 먼저 찾는다. 예약 발송은 예약 생성 로그의
요청 ID에서 `scheduledSendId`를 얻은 뒤, 같은 예약 ID가 포함된 처리 실패 로그로
이어 간다. 모바일 오류는 릴리스 트랙·플랫폼·앱/빌드 버전과 마지막 요청 ID로 같은
API 흐름을 찾는다.

## 경보 임계치

| 신호 | 경고/장애 조건 | 즉시 확인 |
|---|---|---|
| API 오류율 | 5분 창, 요청 20건 이상에서 5xx 비율 20% 이상 | `operational.alert/api_error_rate`, 상위 5xx 경로 |
| API 지연 | 단일 요청 2초 이상 | 동일 요청 ID의 인증·DB·스토리지 이벤트 |
| readiness | 한 번이라도 503; 3분 연속이면 장애 | 환경 검사 코드, DB ping 결과 |
| 예약 발송 | 예정 시각보다 10분 이상 지연 또는 실패 1건 이상 | sweep 상관관계 ID, 예약 ID, DB 상태 |
| 스토리지 | 5분간 실패 3건 이상 또는 단일 흐름 연속 2회 실패 | signed URL/업로드/다운로드 단계 |
| 푸시 | 한 작업에서 실패율 20% 이상 또는 전체 실패 | invalid token, Expo 전송, 토큰 정리 단계 |
| 모바일 치명 오류 | 동일 릴리스·플랫폼에서 15분 내 3건 이상 | 빌드 번호, 마지막 요청 ID, API 5xx |

각 프로세스는 가능한 경우 빠른 현장 신호로 `operational.alert`도 내보낸다. 모바일
치명 오류처럼 공개 입력의 고유 조합을 집계해야 하는 신호는 메모리 고갈 공격을
피하기 위해 서버 프로세스 안에서 집계하지 않는다. 여러 API 인스턴스를 아우르는
최종 경보는 중앙 로그 수집기가 `operational.metric`을 합산해 위 임계치를 평가해야
한다. 특정 공급자 선정·계약은 이 구현 범위에 포함하지 않는다.

## 대응 순서

1. 영향 범위: 시작 시각, 릴리스, 플랫폼, API 상태, 영향을 받은 예약 수를 기록한다.
2. `/api/healthz`와 `/api/readyz`를 확인한다. readiness 실패면 신규 예약 처리보다 DB와
   환경 설정 복구를 우선한다.
3. 요청 ID로 인증 → API → DB/스토리지/푸시 이벤트를 시간순으로 확인한다.
4. 완화:
   - DB: 쓰기 작업과 재처리를 멈추고 연결/지연을 복구한 뒤 readiness를 확인한다.
   - 예약: 원인을 복구한 뒤 sweep을 한 번 실행한다. 처리는 멱등이며 PENDING은 재시도된다.
   - 스토리지: 원본 바이트 검증을 우회하지 말고 사용자가 재시도할 수 있게 유지한다.
   - 푸시: 편지 전달 자체와 분리한다. 실패 토큰을 정리하고 알림만 재시도한다.
5. 복구 확인: readiness 200, API 5xx 비율 임계치 미만, 예약 지연 10분 미만,
   신규 스토리지·푸시 작업 성공을 확인한다.
6. 사용자 안내에는 영향 시간과 현재 상태만 포함한다. 내부 ID, 계정 정보, 글 내용,
   토큰이나 원문 오류는 포함하지 않는다.

## 장애 시나리오 검증

배포 전 아래 테스트를 실행한다.

```bash
cd artifacts/api-server
pnpm exec vitest run src/lib/operationalTelemetry.test.ts
pnpm exec vitest run src/lib/scheduledSendProcessor.test.ts
pnpm exec vitest run src/lib/objectStorage.coverImage.test.ts
pnpm exec vitest run src/routes/userSync.api.test.ts

cd ../friction
pnpm exec vitest run lib/apiOperationalTelemetry.test.ts
```

- DB 지연/실패: readiness 테스트에서 timeout/rejection을 주입하고 503과
  `db.readiness` 실패 유형을 확인한다.
- 스토리지 실패: 잘못된/초과 바이트를 주입하고 원문 없이 안정된 실패 유형만 남는지 확인한다.
- 푸시 실패: Expo chunk/ticket 실패를 주입하고 성공·실패 수가 집계되는지 확인한다.
- 예약 지연: 과거 예정 시각의 PENDING 예약을 처리하고 `delayedCount/maxDelayMs`와
  재시도 가능한 상태를 확인한다.