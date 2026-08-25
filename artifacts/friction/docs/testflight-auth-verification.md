# TestFlight 가입 배포 진단 및 검증 절차

TestFlight에서만 회원가입이 실패할 때, **설정 오류 → Supabase 인증 도달 실패 →
앱 API/프로필 동기화 실패** 순서로 원인을 구분한다. 이 문서와 로그에는 이메일,
access token, Supabase anon key, 응답 본문, 원문 예외를 기록하지 않는다.

## 배포 트랙과 App Store Connect 연결

`app.config.js`가 유일한 Expo 설정 출처다. 정적 `app.json`은 사용하지 않으며,
빌드 번호는 EAS remote app-version에서 관리한다.

| 트랙 | 기기 표시 이름 | iOS 번들 식별자 | EAS 프로젝트 | EAS 프로필 | App Store Connect 앱 ID | 용도 |
| --- | --- | --- | --- | --- | --- | --- |
| development | Friction Dev | `com.theprofound.friction` | `bfb7f9ff-060d-4e45-af6a-621b1be92e93` | development | `6801383039` | Metro에 연결하는 내부 개발용 dev-client |
| preview | Friction Preview | `friction.by.theprofound` | `18ce6a9e-317c-4f64-adc1-182e152d41e3` | preview | `6795505833` | 번들이 내장된 TestFlight 베타 후보 |
| production | Friction | `friction.by.theprofound` | `18ce6a9e-317c-4f64-adc1-182e152d41e3` | production | `6795505833` | App Store 제출 후보 |

preview와 production은 같은 소비자용 App Store 앱에 제출되므로, TestFlight에서
**앱 이름과 버전/빌드 번호**, 그리고 앱이 남긴 `release.track`을 함께 확인한다.
Friction Dev는 Metro URL 입력 화면이 보이는 dev-client이므로 일반 가입 검증 결과로
사용하지 않는다.

### 2026-08-23 검토 결과

- EAS iOS 빌드 이력에는 production과 development 빌드가 모두 존재한다. 따라서
  TestFlight에서 앱 이름과 빌드 번호만 보고 개발용/일반 베타를 추측하면 안 된다.
- EAS production 환경에는 Supabase URL·anon key·API domain 세 값이 존재한다.
- EAS preview 및 development 환경에는 이 세 공개 설정이 존재하지 않았다. 따라서
  현재 `publish-preview.sh`는 Cloud 환경 대조에서 **실패해야 정상**이다. preview
  TestFlight 후보를 새로 만들기 전에 preview Cloud 환경에 production과 의도적으로
  동일한(또는 별도 preview 서비스인) 세 값을 모두 설정해야 한다.
- `eas.json` submit 프로필은 preview/production을 ASC 앱 `6795505833`, development를
  `6801383039`에 연결한다. 새 빌드가 해당 프로필로 제출됐는지는 EAS build ID와
  App Store Connect의 버전/빌드 번호를 대조해 확인한다.

## Cloud 설정 대조와 차단 규칙

릴리즈에는 다음 세 값이 필요하다.

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_DOMAIN`

`preview`와 `production`은 반드시 같은 이름의 EAS Cloud 환경에서 값을 읽는다.
배포 스크립트는 로컬 릴리즈 기준에서 계산한 **짧은 SHA-256 지문**과, 로컬 변수를
비운 상태에서 실행한 EAS Cloud 환경의 지문을 비교한다. 값 자체나 키는 출력하지
않는다. 다음 중 하나라도 발생하면 빌드와 제출을 중단한다.

1. 값이 없거나 placeholder/상대 URL/비 HTTPS URL이다.
2. `APP_RELEASE_TRACK`과 EAS 프로필이 다르다.
3. Cloud의 Supabase 호스트·API 호스트·anon-key 지문이 의도한 릴리즈 기준과 다르다.
4. Expo resolved config의 트랙, 표시 이름, 소비자용 번들 ID 또는 설정 지문이 다르다.
5. 생성된 native JS bundle에 검증한 설정이 들어 있지 않다.

Cloud만 대조하려면 다음을 사용한다.

```bash
bash artifacts/friction/scripts/validate-eas-cloud-env.sh preview
bash artifacts/friction/scripts/validate-eas-cloud-env.sh production
```

이 명령은 Replit의 의도된 릴리즈 설정이 현재 셸에 로드된 상태에서 실행한다. 세
기준값 중 하나라도 로컬에 없으면 Cloud 값을 추측하지 않고 실패한다.

## 빌드 및 App Store Connect 점검

### preview TestFlight 후보

```bash
bash artifacts/friction/scripts/publish-preview.sh
```

1. 출력에서 `track=preview`와 지문 검증 성공을 확인한다.
2. EAS build 로그에서 `Resolved Expo config validated` 및
   `Validated Supabase/API configuration in ... EAS native bundle(s)`를 확인한다.
3. EAS build ID, 버전, build number를 기록한다. 설정값이나 이메일은 기록하지 않는다.
4. App Store Connect에서 앱 ID `6795505833`의 TestFlight 빌드가 같은 build number인지,
   **Friction Preview**로 설치되는지 확인한다.
5. 외부 테스터에게 배포할 경우 해당 빌드를 올바른 TestFlight 그룹에 선택한다.

### production 제출 후보

```bash
bash artifacts/friction/scripts/publish-ios.sh
```

1. 출력에서 `track=production`과 Cloud 지문 검증 성공을 확인한다.
2. App Store Connect 앱 ID `6795505833`, 소비자용 bundle ID
   `friction.by.theprofound`, EAS build ID/버전/빌드 번호가 일치하는지 확인한다.
3. TestFlight에서 **Friction**의 동일 빌드 번호를 선택한 뒤 내부 테스터에게 배포한다.

### development dev-client

```bash
bash artifacts/friction/scripts/publish-dev.sh
```

이 트랙은 App Store Connect 앱 ID `6801383039`과 Friction Dev를 사용한다. Metro에서
실행되는 코드는 설치된 이진 파일과 다를 수 있으므로, 이 빌드의 가입 결과로
preview/production 릴리즈를 통과시키지 않는다.

## 새 설치 iPhone 재현 절차

각 시나리오는 TestFlight에서 이전 빌드를 제거하고, 대상 트랙의 새 build number를
새로 설치한 뒤 실행한다.

| 시나리오 | 실행 | 기대 결과와 판별 |
| --- | --- | --- |
| 설정 검증 | 앱을 처음 실행 | 설정이 누락되면 로그인 전 “앱을 시작할 수 없어요” 화면이 보인다. API/Supabase 요청은 시도하지 않는다. |
| API 사전 확인 | 회원가입 2단계 진입 | API health check가 실패하면 가입 전 “앱 서버에 연결하지 못하고 있어요” 안내가 보인다. 입력은 유지되며, 연결 후 가입을 다시 시도할 수 있다. |
| Supabase 인증 실패 | 가입 요청 전에 기기를 오프라인으로 전환 | 로딩이 끝난 뒤 오류 팝업에 `SIGNUP_NETWORK`와 진단 번호가 보이고 입력 화면이 유지된다. |
| API 프로필 동기화 실패 | 가입 직후 API를 차단하거나 서버를 일시 중단 | 로딩이 끝난 뒤 오류 팝업에 `SIGNUP_API_UNREACHABLE` 또는 `SYNC_*` 코드와 진단 번호가 보이고, 로그인 탭에서 다시 시도할 수 있다. |
| 자동 확인 가입 | 약관 동의 후 가입 완료 | 프로필 동기화가 끝난 뒤 홈으로 이동하며 흰 화면/무한 로딩이 없다. |
| 이메일 확인 가입 | 이메일 확인이 필요한 계정으로 가입 | 이메일 안내 화면이 표시되고 로그인 화면으로 돌아갈 수 있다. |
| 재실행/재로그인 | 홈 진입 후 강제 종료, 재실행, 로그아웃, 재로그인 | 로딩이 끝나고 정상 화면이 보인다. |
| 만료·교체된 로그인 정보 | 이전 설치에서 로그아웃하지 않고, 서버에서 해당 세션을 폐기한 뒤 앱을 재실행 | LogBox/빨간 오류 화면 없이 로그인 화면으로 돌아간다. 이어서 자동 확인 가입을 완료하면 프로필 동기화 뒤 홈으로 이동한다. |

## 운영 진단 확인

네이티브 앱은 시작 시 API `/healthz`를 비차단으로 확인한다. 가입 실패 팝업의
오류 코드와 진단 번호는 `client-logs: auth-flow diagnostic reported` 로그의
`authFlow.errorClass`와 `authFlow.flowId`에 같은 값으로 남는다. 앱 API에 도달하지
못한 경우에는 해당 팝업 번호로 API 배포/네트워크 범위를 먼저 확인하고, 도달한 경우에는
서버 로그에서 `flowId`로 `sign-up`과 `profile-sync` 이벤트를 함께 조회한다.

로그에는 아래의 안전한 값만 남는다.

- `phase`/`outcome`/오류 **종류** (`config`, `api-reachability`, `sign-up`,
  `profile-sync` 등)
- 플랫폼, 앱 버전, 빌드 번호
- release track, Supabase/API **호스트명**, 16자리 설정 지문, 설정 상태

로그에 이메일, bearer token, anon key, URL query, 응답 본문 또는 원문 예외 메시지가
있다면 진단 구현을 배포하지 않는다. 팝업과 화면 인라인 문구에도 이 값들을 넣지 않는다.
치명적 JS 오류는 앱을 다시 실행한 뒤
`client-logs: fatal JS error reported by client`로 별도 확인한다.

### 가입 팝업 코드 판별

| 팝업 코드 | 의미 | 운영 확인 |
| --- | --- | --- |
| `SIGNUP_AUTH_SERVICE` | Supabase가 가입 요청을 거절함 | 같은 `flowId`의 `sign-up;outcome=failed` 이벤트 확인 |
| `SIGNUP_NETWORK` | Supabase 요청이 전송·응답되기 전에 실패함 | release 호스트/설정과 기기 네트워크 확인 |
| `SIGNUP_API_UNREACHABLE` | 인증 후 앱 API에 도달하지 못함 | API 배포 상태와 네트워크 경로 확인 |
| `SYNC_*` | 앱 API에는 도달했지만 프로필 동기화가 실패함 | API 로그에서 같은 `flowId`의 `profile-sync` 이벤트 확인 |
| `AUTH_TRANSITION_ERROR` / `SIGNUP_UNKNOWN` | 세션 확정 또는 예상 밖 앱 오류 | 같은 `flowId`의 전체 `sign-up` 흐름 확인 |