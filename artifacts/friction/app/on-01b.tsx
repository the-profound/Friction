import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * 분할 화면은 작성 화면(on-01a)에 `mode` 상태로 통합되었다.
 *
 * 과거 분할 라우트(/on-01b)로 들어오는 모든 진입점(메모 목록의 분할 단계 이어쓰기,
 * 마감 화면 on-01c의 단계 뒤로가기 등)을 통합 화면으로 그대로 전달한다.
 * returnPage/returnBlock 등 기존 파라미터를 보존하고 `mode=dividing`을 덧붙여
 * 통합 화면이 분할 모드로 진입하도록 한다. 이렇게 하면 on-01c는 수정할 필요가 없다.
 */
export default function DividingRedirect() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/on-01a", params: { ...params, mode: "dividing" } }} />;
}
