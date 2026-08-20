# TestFlight 인증 흰 화면 검증 절차

새 preview 또는 production 빌드를 TestFlight에 올리기 전에 릴리즈 환경 검증이
통과했는지 확인하고, 아래 시나리오를 새로 설치한 기기에서 실행한다. 이 문서에는
이메일 주소, 토큰, 사용자 식별자를 기록하지 않는다.

## 빌드 전 확인

1. `pnpm --filter @workspace/friction validate:release`를 실행한다.
2. `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
   `EXPO_PUBLIC_DOMAIN`이 모두 EAS preview/production 환경에 설정되어 있는지
   확인한다. 출력에는 값 자체가 나타나지 않아야 한다.
3. `pnpm --filter @workspace/friction test`를 실행한다.
4. 빌드 로그에서 `Release configuration validated`와
   `Validated Supabase/API configuration in ... EAS native bundle(s)`를 확인한다.
   누락된 값이나 번들 검증 실패가 있으면 빌드/제출을 중단한다. EAS의
   `app.config.js`와 build hook이 Cloud 환경에서도 같은 검사를 수행한다.

## 새 설치 시나리오

각 시나리오는 TestFlight에서 이전 빌드를 삭제하고 새로 설치한 뒤 실행한다.

| 시나리오 | 실행 | 기대 결과 |
| --- | --- | --- |
| 자동 확인 가입 | 약관 동의 후 가입 완료 | 프로필 동기화가 끝난 뒤 홈 화면으로 이동하며 흰 화면/무한 로딩이 없다 |
| 이메일 확인 가입 | 이메일 확인이 필요한 계정으로 가입 | 이메일 안내 화면이 표시되고 로그인 화면으로 돌아갈 수 있다 |
| 프로필 동기화 실패 | 가입 직후 API를 차단하거나 서버를 일시 중단 | 가입 실패 메시지가 표시되고 로그인 탭에서 프로필 동기화를 재시도할 수 있으며 앱이 종료되지 않는다 |
| 오프라인 가입 | 가입 요청 전에 기기를 오프라인으로 전환 | 네트워크 오류 메시지가 표시되고 입력 화면이 유지된다 |
| 늦은 복원 | 앱을 종료하지 않고 가입 완료 직후 백그라운드/포그라운드 전환 | 늦은 복원이 홈/이메일 안내 화면을 로그아웃 상태로 되돌리지 않는다 |
| 재실행/재로그인 | 홈 진입 후 앱 강제 종료, 재실행, 로그아웃, 재로그인 | 매번 로딩이 끝나고 정상 화면이 표시된다 |

## 진단 확인

- 앱이 설정 누락으로 시작되면 placeholder 요청이나 빈 `/api` 상대 URL 대신
  설정 오류 화면이 표시되어야 한다.
- 치명적 JS 오류가 발생한 경우 앱을 다시 실행한 뒤 API 서버 로그에서
  `client-logs: fatal JS error reported by client`를 확인한다.
- 인증 전환 진단은 `client-logs: client diagnostic reported`로 기록되며
  단계/결과/오류 종류만 포함해야 한다. 이메일, access token, 응답 본문은
  포함하지 않는다.