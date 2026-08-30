export type RandomPreliminaryQuestion = {
  title: string;
  description: string;
};

const RANDOM_QUESTIONS: readonly RandomPreliminaryQuestion[] = [
  { title: "오늘 가장 오래 마음에 남은 장면은 무엇이었을까?", description: "그 장면이 남긴 감정을 천천히 떠올려 보세요." },
  { title: "지금의 나에게 꼭 필요한 말은 무엇일까?", description: "누군가에게 건네듯 한 문장으로 적어 보세요." },
  { title: "최근에 새롭게 알게 된 나의 모습은 무엇일까?", description: "작은 변화라도 구체적인 순간과 함께 살펴보세요." },
  { title: "요즘 내가 자연스럽게 피하고 있는 것은 무엇일까?", description: "피하고 싶은 마음이 생긴 순간을 따라가 보세요." },
  { title: "오늘 나를 조금 편안하게 만든 것은 무엇이었을까?", description: "아주 사소한 일이라도 괜찮습니다." },
  { title: "지금 다시 선택할 수 있다면 무엇을 다르게 해보고 싶을까?", description: "바꾸고 싶은 이유까지 이어서 생각해 보세요." },
  { title: "최근 누군가에게 고마웠던 순간은 언제였을까?", description: "그때 전하지 못한 말을 적어 보세요." },
  { title: "요즘 내가 가장 기대하고 있는 일은 무엇일까?", description: "기대하는 마음이 어디에서 시작됐는지 살펴보세요." },
  { title: "내가 중요하게 여기면서도 자주 잊는 것은 무엇일까?", description: "그 가치를 기억하게 하는 경험을 떠올려 보세요." },
  { title: "오늘의 나를 한 단어로 표현한다면 무엇일까?", description: "그 단어를 고른 이유를 짧게 풀어 보세요." },
  { title: "최근에 마음이 움직였던 말이나 행동은 무엇이었을까?", description: "왜 그 순간에 반응했는지 살펴보세요." },
  { title: "이번 주에 나를 위해 남겨두고 싶은 시간은 언제일까?", description: "그 시간에 하고 싶은 일을 구체적으로 적어 보세요." },
];

export function generateRandomPreliminaryThoughtQuestion(
  excludedTitles: ReadonlySet<string> = new Set(),
): RandomPreliminaryQuestion | null {
  const available = RANDOM_QUESTIONS.filter((question) => !excludedTitles.has(question.title));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)] ?? null;
}