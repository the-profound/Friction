import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

function styleBlock(source: string, name: string): string {
  const match = source.match(
    new RegExp(`${name}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`),
  );
  if (!match) throw new Error(`Missing StyleSheet entry: ${name}`);
  return match[1];
}

function expectFixedNonGrowingStyle(
  block: string,
  expectedSize: string,
  dimension: "height" | "width" = "height",
) {
  expect(block).toContain(`${dimension}: ${expectedSize}`);
  expect(block).toContain("flexGrow: 0");
  expect(block).toContain("flexShrink: 0");
}

function agreementControlBlocks(source: string): string[] {
  return [...source.matchAll(/<ScalePressable([\s\S]*?)<\/ScalePressable>/g)]
    .map((match) => match[1])
    .filter((block) => block.includes('accessibilityRole="checkbox"'));
}

describe("signup step-two button layout contract", () => {
  const login = read("app/login.tsx");

  it("keeps the back row compact even when its form parent has spare height", () => {
    const backRow = styleBlock(login, "backRow");
    const backRowContent = styleBlock(login, "backRowContent");

    expect(login).toContain("const SIGNUP_BACK_ROW_HEIGHT = 32;");
    expectFixedNonGrowingStyle(backRow, "SIGNUP_BACK_ROW_HEIGHT");
    expectFixedNonGrowingStyle(backRowContent, "SIGNUP_BACK_ROW_HEIGHT");
    expect(backRowContent).toContain('flexDirection: "row"');
    expect(backRowContent).toContain('alignItems: "center"');
  });

  it("gives both agreement controls a fixed native touch row and preserves the 22px visual box", () => {
    const checkboxButton = styleBlock(login, "checkboxButton");
    const checkboxButtonContent = styleBlock(login, "checkboxButtonContent");
    const checkbox = styleBlock(login, "checkbox");

    expect(login).toContain("const SIGNUP_CHECKBOX_TOUCH_TARGET = 44;");
    expectFixedNonGrowingStyle(
      checkboxButton,
      "SIGNUP_CHECKBOX_TOUCH_TARGET",
      "height",
    );
    expectFixedNonGrowingStyle(
      checkboxButtonContent,
      "SIGNUP_CHECKBOX_TOUCH_TARGET",
      "height",
    );
    expectFixedNonGrowingStyle(
      checkboxButton,
      "SIGNUP_CHECKBOX_TOUCH_TARGET",
      "width",
    );
    expectFixedNonGrowingStyle(
      checkboxButtonContent,
      "SIGNUP_CHECKBOX_TOUCH_TARGET",
      "width",
    );
    expect(checkbox).toContain("width: 22");
    expect(checkbox).toContain("height: 22");

    const controls = agreementControlBlocks(login);
    expect(controls).toHaveLength(2);
    expect(controls.find((block) => block.includes("setAgreedTerms"))).toEqual(
      expect.stringContaining("checked: agreedTerms"),
    );
    expect(
      controls.find((block) => block.includes("setAgreedPrivacy")),
    ).toEqual(expect.stringContaining("checked: agreedPrivacy"));
    for (const control of controls) {
      expect(control).toContain("style={styles.checkboxButton}");
      expect(control).toContain("contentStyle={styles.checkboxButtonContent}");
      expect(control).toContain("disabled={isLoading}");
      expect(control).toContain("disabled: isLoading");
    }
  });

  it("keeps the submit control fixed and actionable across disabled and loading states", () => {
    const button = styleBlock(login, "button");
    const buttonContent = styleBlock(login, "buttonContent");

    expect(login).toContain("const SIGNUP_SUBMIT_BUTTON_HEIGHT = 52;");
    expectFixedNonGrowingStyle(button, "SIGNUP_SUBMIT_BUTTON_HEIGHT");
    expectFixedNonGrowingStyle(buttonContent, "SIGNUP_SUBMIT_BUTTON_HEIGHT");
    expect(buttonContent).toContain('width: "100%"');
    expect(login).toContain("disabled={!canSubmitSignupStep2}");
    expect(login).toMatch(
      /accessibilityState=\{\{[\s\S]*?disabled: !canSubmitSignupStep2,[\s\S]*?busy: isLoading,[\s\S]*?\}\}/,
    );
    expect(login).toContain("{isLoading ? (");
    expect(login).toContain(
      '<ActivityIndicator size="small" color={Colors.white} />',
    );
    expect(login).toContain("if (isLoading) return;");
    expect(login).toContain("finally {");
    expect(login).toContain("setIsLoading(false);");
  });

  it("keeps PillButton's caller styles from re-enabling native flex growth", () => {
    const pillButton = read("components/shared/PillButton.tsx");

    expect(pillButton).toContain("{ height, flexGrow: 0, flexShrink: 0 }");
    expect(
      pillButton.match(/\{ height, flexGrow: 0, flexShrink: 0 \}/g),
    ).toHaveLength(2);
  });
});
