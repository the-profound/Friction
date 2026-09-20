# 통합 질문 답변 작성률

## 공통 집계 계약

기본 집계 단위는 **질문 항목 노출 기회(question opportunity)** 다. 세션 수와
질문 항목 수를 한 분모에 섞지 않는다. 모든 항목 이벤트는 다음 속성을 가진다.

- `question_surface`: `question_queue` 또는 `reading_question`
- `question_opportunity_id`: surface로 이름공간을 분리한 고유 질문 기회
- `question_session_id`: surface로 이름공간을 분리한 흐름 세션
- `question_outcome`: `exposed`, `answer_started`, `save_succeeded`,
  `save_failed` (활성화 진단 이벤트에는 `activated`, `activation_failed`)
- `question_aggregation_unit`: 통합 산식 대상은 `question_opportunity`

읽기 질문의 `reading_question_session_exposed`는 세션 진단용이며
`question_aggregation_unit: session`이다. 통합 분모에는 넣지 않는다.

## 산식과 기간

동일한 분석 기간과 동일한 환경/앱 버전 필터를 모든 이벤트에 적용한다.
기간은 이벤트의 수집 시각을 기준으로 하며, 과거 데이터 백필은 하지 않는다.

```
통합 질문 답변 작성률 =
  (질문 큐 고유 save_succeeded 기회 + 읽기 질문 고유 save_succeeded 기회)
  / (질문 큐 고유 exposed 기회 + 읽기 질문 고유 exposed 기회)
```

surface별 비율의 단순 평균은 사용하지 않는다. 대시보드는 통합 분자·분모·비율과
함께 각 surface의 `exposed`, `answer_started`, `save_succeeded`,
`save_failed`, 전환율, 전체 노출 기여도, 전체 저장 성공 기여도를 표시한다.
`calculateCombinedQuestionAnswerMetric`이 이 가중 산식과 분해를 구현한다.

## 포함·제외 및 품질 한계

- `$insert_id`와 `question_opportunity_id + question_outcome`으로 재전송을
  중복 제거한다. 질문 큐는 기기 저장소에도 전달 상태를 보존한다.
- 저장 성공만 분자에 포함한다. 작성 시작, 저장 실패, 미완료 세션은 분자에서
  제외하지만 노출이 있었다면 분모에는 남는다.
- 분석이 비활성인 환경에서는 이벤트가 생성되지 않으므로 해당 기회는 관측할 수
  없다. 분석 활성/비활성 환경을 같은 추세선에서 비교하지 않는다.
- 클라이언트 종료, 오프라인 큐 유실, 공급자 전달 실패로 이벤트가 누락될 수 있다.
  특히 노출 누락은 비율을 높이고 저장 성공 누락은 비율을 낮출 수 있다.
- 기간 경계에서 노출과 저장이 서로 다른 기간에 잡힐 수 있다. 장기 추세에는
  동일한 기간 필터를 유지하고, 짧은 기간은 진행 중 기회가 많음을 명시한다.

품질 모니터링에서는 surface별 이벤트 수 합계가 통합 합계와 일치하는지,
중복 제거 전후 차이, `save_succeeded > exposed`, 분석 비활성 릴리스,
저장 실패율 급증을 확인한다.