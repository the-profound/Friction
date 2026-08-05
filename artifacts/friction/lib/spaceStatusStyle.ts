import { Colors } from "@/constants/tokens";

export type SpaceStatusStyle = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  textColor: string;
};

export function spaceStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "RECRUITING") return "모집 중";
  if (status === "ARCHIVED") return "종료";
  return status;
}

export function spaceStatusStyle(status: string): SpaceStatusStyle {
  if (status === "ACTIVE") {
    return {
      backgroundColor: Colors.noticeAccent,
      borderColor: Colors.noticeAccent,
      borderWidth: 0,
      textColor: Colors.white,
    };
  }
  if (status === "RECRUITING") {
    return {
      backgroundColor: Colors.transparent,
      borderColor: Colors.noticeAccent,
      borderWidth: 1,
      textColor: Colors.noticeAccent,
    };
  }
  return {
    backgroundColor: Colors.zinc700,
    borderColor: Colors.zinc700,
    borderWidth: 0,
    textColor: Colors.white,
  };
}
