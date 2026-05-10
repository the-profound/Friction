import { Redirect } from "expo-router";

export default function SettingsScreen() {
  return <Redirect href={"/mypage" as never} />;
}
