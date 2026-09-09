import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readScreenSource = readFileSync(
  new URL("../../app/read.tsx", import.meta.url),
  "utf8",
);
const questionCardSource = readFileSync(
  new URL("../../components/QuestionCardCurl/QuestionCardCurl.tsx", import.meta.url),
  "utf8",
);

describe("question-card answer retention", () => {
  it("keeps answer ownership above the three-slot pager window", () => {
    expect(readScreenSource).toContain(
      "const questionCardAnswersRef = useRef<Record<number, string>>({});",
    );
    expect(readScreenSource).toContain("initialAnswers={questionCardAnswersRef.current}");
    expect(readScreenSource).toContain("onAnswersChange={handleQuestionCardAnswersChange}");
    expect(questionCardSource).toContain(
      "const [answers, setAnswers] = useState<Record<number, string>>(() => initialAnswers);",
    );
  });

  it("clears retained answers only when the reading identity changes", () => {
    const identityResetEffect = readScreenSource.slice(
      readScreenSource.indexOf("useEffect(() => {", readScreenSource.indexOf("const committedTotalPagesRef")),
      readScreenSource.indexOf("}, [readerIdentity]);") + "}, [readerIdentity]);".length,
    );

    expect(identityResetEffect).toContain("questionCardAnswersRef.current = {};");
  });
});