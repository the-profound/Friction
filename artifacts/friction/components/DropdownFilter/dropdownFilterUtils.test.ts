import { describe, expect, it } from "vitest";
import {
  getDropdownFilterLabel,
  isDropdownFilterActive,
} from "./dropdownFilterUtils";

describe("DropdownFilter presentation", () => {
  it("uses the explicit default value instead of assuming an all key", () => {
    expect(isDropdownFilterActive("recent", "recent")).toBe(false);
    expect(isDropdownFilterActive("archived", "recent")).toBe(true);
  });

  it("uses the filter label for the default value", () => {
    expect(
      getDropdownFilterLabel({
        label: "기록 종류",
        value: "all",
        defaultValue: "all",
        selectedOptionLabel: "편지",
      }),
    ).toBe("기록 종류");
  });

  it("can show the selected option label for the default value", () => {
    expect(
      getDropdownFilterLabel({
        label: "종류",
        value: "thought",
        defaultValue: "thought",
        selectedOptionLabel: "단상",
        showDefaultOptionLabel: true,
      }),
    ).toBe("단상");
  });

  it("uses the selected label for an active value", () => {
    expect(
      getDropdownFilterLabel({
        label: "보기 방식",
        value: "mine",
        defaultValue: "all",
        selectedOptionLabel: "내 기록",
      }),
    ).toBe("내 기록");

    expect(
      getDropdownFilterLabel({
        label: "보기 방식",
        value: "mine",
        defaultValue: "all",
        selectedLabel: "선택됨",
        selectedOptionLabel: "내 기록",
      }),
    ).toBe("선택됨");
  });
});