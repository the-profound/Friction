import { useCallback, useEffect, useRef, useState } from "react";

/* ─── Design tokens ───────────────────────────────────────────────── */
const C = {
  zinc900: "#18181b", zinc800: "#27272a", zinc700: "#3f3f46",
  zinc600: "#52525b", zinc500: "#71717a", zinc400: "#a1a1aa",
  zinc300: "#d4d4d8", zinc200: "#e4e4e7", zinc100: "#f4f4f5",
  zinc50: "#fafafa", white: "#ffffff",
};
const FONT  = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const SERIF = "'Eulyoo1945-Regular',Georgia,serif";

/* ─── Layout ──────────────────────────────────────────────────────── */
const PH_W     = 390;
const PH_H     = 844;
const SMALL_W  = Math.round(PH_W * 0.84);
const FULL_H   = Math.round(PH_W * (8 / 5));
const PANEL_N  = 5;
const SMALL_H  = Math.ceil(Math.round(FULL_H * 0.84) / PANEL_N) * PANEL_N;
const SMALL_LEFT = Math.round((PH_W - SMALL_W) / 2);
const REST_TY  = SMALL_H + 60;

/* Spring overlay height */
const SPRING_H = 42;

/* ─── Curl animation constants ────────────────────────────────────── */
const CURL_DURATION = 950;
/*
 * 오른쪽 지수가 더 작아 더 빠르게 선행 → 사선 분할선.
 * 둘 다 t=1에서 1로 수렴 → 상단 스프링에 동시 도달.
 */
const RIGHT_EXP = 0.5;
const LEFT_EXP  = 0.7;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
/*
 * taper: 0과 1에서 0, 중간에서 최대 1.
 * 완전히 펼쳐지거나 완전히 말릴 때 접힘 골 그림자가 소멸하도록.
 */
function taper(t: number) { return Math.min(1, t * 5, (1 - t) * 5); }

const EASE_SNAP = "cubic-bezier(0.34,1.56,0.64,1)";

/* ─── Tear (fly-away) animation constants ─────────────────────────── */
/*
 * 빈 카드 스와이프 시 종이가 1시 방향으로 날아가는 애니메이션.
 * TEAR_FADE_DONE: 이 rawProgress에서 opacity=0 도달 → 이후 애니메이션 종료.
 */
const TEAR_DURATION  = 1700;   // ms (total reference speed)
const TEAR_FADE_DONE = 0.4;    // rawProgress threshold (paper becomes fully transparent)

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/*
 * 스프링 바인딩에서 뜯겨 나간 윗변의 톱니(찢김) 클립.
 * 0% 100% → 위쪽 톱니 경로 → 100% 100% 순으로 닫힘.
 */
const TORN_TOP_CLIP = (() => {
  const teeth = 26;
  const pts: string[] = ["0% 100%"];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * 100;
    const y = i % 2 === 0 ? 4 : 0.5;
    pts.push(`${x.toFixed(2)}% ${y}%`);
  }
  pts.push("100% 100%");
  return `polygon(${pts.join(", ")})`;
})();

/* ─── Types ───────────────────────────────────────────────────────── */
interface CardEntry    { qIdx: number; answer: string; }
interface IncomingCard { question: string; answer: string; }
interface Snap         { question: string; answer: string; }

/* ─── SpringCoil (9개 금속 링, 첨부 코드 디자인) ──────────────────── */
/*
 * 카드 컨테이너에 absolute 포지셔닝. overflow:hidden 바깥에 위치하여
 * 모든 애니메이션 레이어 위에 항상 표시됨.
 */
function SpringCoil() {
  return (
    <div style={{
      position: "absolute",
      top: 10, left: 20, right: 20,
      height: 16,
      display: "flex",
      justifyContent: "space-between",
      zIndex: 10,
      pointerEvents: "none",
    }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} style={{
          width: 8, height: 24,
          borderRadius: 4,
          background: "linear-gradient(90deg, #555 0%, #ccc 50%, #444 100%)",
          boxShadow: "0 4px 6px rgba(0,0,0,0.4)",
        }} />
      ))}
    </div>
  );
}

/* ─── CardContent ─────────────────────────────────────────────────── */
function CardContent({
  question, answer, onChange, editable = true, ghostText = false,
}: {
  question: string; answer: string;
  onChange: (v: string) => void;
  editable?: boolean;
  ghostText?: boolean;
}) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      paddingLeft: 28, paddingRight: 28, paddingTop: 20, paddingBottom: 24,
      overflow: "hidden",
    }}>
      <p style={{
        margin: "0 0 20px 0",
        fontSize: 18, fontFamily: SERIF, fontWeight: 400,
        color: ghostText ? "transparent" : C.zinc900,
        lineHeight: "28px", letterSpacing: "0.3px",
        userSelect: "none", pointerEvents: "none",
      }}>
        {question}
      </p>
      <textarea
        value={answer}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!editable}
        placeholder={ghostText ? "" : "생각을 자유롭게 적어보세요..."}
        style={{
          flex: 1, border: "none", outline: "none", resize: "none",
          background: "transparent", padding: 0,
          fontSize: 15, fontFamily: SERIF,
          color: ghostText ? "transparent" : C.zinc700,
          caretColor: C.zinc800,
          lineHeight: "28px", letterSpacing: "0.5px",
        }}
      />
    </div>
  );
}

/*
 * CardFace: 애니메이션 레이어 내부용 카드 전체 비주얼.
 * SPRING_H 스페이서 + CardContent.
 * Spring 자체는 바깥 컨테이너에 absolute로 따로 붙는다.
 */
function CardFace({ question, answer }: { question: string; answer: string }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: C.white,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ height: SPRING_H, flexShrink: 0 }} />
      <CardContent
        question={question} answer={answer}
        onChange={() => {}} editable={false}
      />
    </div>
  );
}

/* ─── InteractiveOverlay ──────────────────────────────────────────── */
function InteractiveOverlay({
  ty, question, answer, editable, onChange, zIndex,
}: {
  ty: number; question: string; answer: string;
  editable: boolean; onChange: (v: string) => void; zIndex: number;
}) {
  return (
    <div style={{
      position: "absolute",
      left: SMALL_LEFT, width: SMALL_W, height: SMALL_H,
      top: "50%", marginTop: -(SMALL_H / 2),
      transform: `translateY(${ty}px)`,
      borderRadius: 20, overflow: "hidden",
      background: "transparent",
      display: "flex", flexDirection: "column",
      zIndex,
      pointerEvents: editable ? "auto" : "none",
    }}>
      <div style={{ height: SPRING_H, flexShrink: 0 }} />
      <CardContent
        question={question} answer={answer}
        onChange={onChange} editable={editable}
        ghostText
      />
    </div>
  );
}

/* ─── StatusBar ───────────────────────────────────────────────────── */
function StatusBar() {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 48,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 22px 0", zIndex: 20, pointerEvents: "none",
    }}>
      <span style={{ fontSize: 12, fontFamily: FONT, fontWeight: 600, color: C.white }}>9:41</span>
      <div style={{
        position: "absolute", left: "50%", top: 10,
        transform: "translateX(-50%)",
        width: 120, height: 32, background: "#000", borderRadius: 20,
      }} />
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <svg width="16" height="12" viewBox="0 0 16 12" fill={C.white}>
          <rect x="0" y="6" width="3" height="6" rx="0.5" />
          <rect x="4" y="4" width="3" height="8" rx="0.5" />
          <rect x="8" y="2" width="3" height="10" rx="0.5" />
          <rect x="12" y="0" width="3" height="12" rx="0.5" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0" y="1" width="21" height="10" rx="2" stroke={C.white} strokeWidth="1.2" />
          <rect x="22" y="4" width="2" height="4" rx="1" fill={C.white} opacity="0.5" />
          <rect x="1.5" y="2.5" width="17" height="7" rx="1.2" fill={C.white} />
        </svg>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * Main Component
 * ════════════════════════════════════════════════════════════════════ */
export default function QuestionCardSwipePreview() {

  /* ── 카드 데이터 상태 ─────────────────────────────────────────── */
  const [cards, setCards]         = useState<CardEntry[]>([]);
  const [ptr, setPtr]             = useState(0);
  const [newAnswer, setNewAnswer] = useState("");
  const [cardSeq, setCardSeq]     = useState(0);

  /* ── 애니메이션 공통 상태 ─────────────────────────────────────── */
  const [animating, setAnimating]       = useState(false);
  /* "forward": 다음 카드로 넘어감  "back": 이전 카드로 돌아감 */
  const [animDir, setAnimDir]           = useState<"forward"|"back">("forward");
  const [outgoingSnap, setOutgoingSnap] = useState<Snap | null>(null);
  const [incoming, setIncoming]         = useState<IncomingCard | null>(null);

  /*
   * 애니메이션 종류:
   *   "curl" — 내용 있는 카드: 말려 올라가는 종이 효과
   *   "tear" — 빈 카드:       1시 방향으로 날아가는 효과
   */
  const [animType, setAnimType]         = useState<"curl" | "tear">("curl");

  /*
   * curl 진행도 (0→1, eased).
   * tear 진행도 (0→TEAR_FADE_DONE, raw) — 두 타입이 동시에 활성화되지 않으므로 공유.
   */
  const [rawProgress, setRawProgress]   = useState(0);

  /* drag 팔로우용 cardTY (애니메이션 중에는 0으로 유지) */
  const [cardTY, setCardTY]             = useState(0);
  const [cardTyTrans, setCardTyTrans]   = useState("none");

  /* ── Refs ─────────────────────────────────────────────────────── */
  const animatingRef  = useRef(false);
  const ptrRef        = useRef(0);
  const cardsRef      = useRef<CardEntry[]>([]);
  const newAnswerRef  = useRef("");
  const cardSeqRef    = useRef(0);
  const dragging      = useRef(false);
  const startY        = useRef(0);
  const lastDY        = useRef(0);
  const dragRaf       = useRef<number>(0);
  const curlRaf       = useRef<number | null>(null);

  useEffect(() => { animatingRef.current = animating; }, [animating]);
  useEffect(() => { ptrRef.current = ptr; },            [ptr]);
  useEffect(() => { cardsRef.current = cards; },        [cards]);
  useEffect(() => { newAnswerRef.current = newAnswer; }, [newAnswer]);
  useEffect(() => { cardSeqRef.current = cardSeq; },    [cardSeq]);

  /* ── 파생 표시값 ─────────────────────────────────────────────── */
  const isNewCard     = ptr === cards.length;
  const currentQIdx   = isNewCard ? cardSeq % QUESTIONS.length : (cards[ptr]?.qIdx ?? 0);
  const currentQ      = QUESTIONS[currentQIdx];
  const currentAnswer = isNewCard ? newAnswer : (cards[ptr]?.answer ?? "");

  const displayQ      = outgoingSnap ? outgoingSnap.question : currentQ;
  const displayAnswer = outgoingSnap ? outgoingSnap.answer   : currentAnswer;

  function handleAnswerChange(v: string) {
    if (isNewCard) { setNewAnswer(v); newAnswerRef.current = v; }
    else setCards(prev => prev.map((c, i) => i === ptr ? { ...c, answer: v } : c));
  }

  /* ── afterTransition ─────────────────────────────────────────── */
  const afterTransition = useCallback(() => {
    animatingRef.current = false;
    setAnimating(false);
    setOutgoingSnap(null);
    setIncoming(null);
    setRawProgress(0);
    setCardTY(0);
    setCardTyTrans("none");
  }, []);

  /* ════════════════════════════════════════════════════════════════
   * runCurlRAF — RAF 루프로 rawProgress 0→1 구동
   * ════════════════════════════════════════════════════════════════ */
  const runCurlRAF = useCallback((onComplete: () => void) => {
    if (curlRaf.current !== null) cancelAnimationFrame(curlRaf.current);
    setRawProgress(0);
    const startTime = performance.now();
    const step = (now: number) => {
      const raw = Math.min(1, (now - startTime) / CURL_DURATION);
      setRawProgress(easeInOutCubic(raw));
      if (raw < 1) {
        curlRaf.current = requestAnimationFrame(step);
      } else {
        onComplete();
      }
    };
    curlRaf.current = requestAnimationFrame(step);
  }, []);

  /* ════════════════════════════════════════════════════════════════
   * triggerAdvance — 다음 카드로
   *
   * hasAnswer=true  → curl 애니메이션 (내용 있는 카드, 말려 올라감)
   * hasAnswer=false → tear 애니메이션 (빈 카드, 1시 방향으로 날아감)
   * ════════════════════════════════════════════════════════════════ */
  const triggerAdvance = useCallback((hasAnswer: boolean) => {
    if (animatingRef.current) return;

    const _ptr   = ptrRef.current;
    const _cards = cardsRef.current;
    const _ans   = newAnswerRef.current;
    const _seq   = cardSeqRef.current;
    const _isNew = _ptr === _cards.length;

    const outQ   = _isNew ? QUESTIONS[_seq % QUESTIONS.length] : QUESTIONS[_cards[_ptr].qIdx];
    const outAns = _isNew ? _ans : (_cards[_ptr]?.answer ?? "");

    let nextCards = _cards;
    let nextPtr: number;
    let nextSeq   = _seq;

    if (_isNew) {
      nextSeq = _seq + 1;
      if (hasAnswer) {
        const entry: CardEntry = { qIdx: _seq % QUESTIONS.length, answer: _ans };
        nextCards = [..._cards, entry];
        nextPtr   = nextCards.length;
      } else {
        nextPtr = _cards.length;
      }
    } else {
      nextPtr = _ptr + 1;
    }

    const nextIsNew = nextPtr === nextCards.length;
    const nextQ     = nextIsNew
      ? QUESTIONS[nextSeq % QUESTIONS.length]
      : QUESTIONS[nextCards[nextPtr].qIdx];
    const nextAns   = nextIsNew ? "" : (nextCards[nextPtr].answer ?? "");

    setAnimating(true);
    animatingRef.current = true;
    setAnimDir("forward");
    setOutgoingSnap({ question: outQ, answer: outAns });
    setIncoming({ question: nextQ, answer: nextAns });

    if (hasAnswer) {
      /* ── curl: 내용 있는 카드 → 말려 올라가는 효과 ── */
      setAnimType("curl");
      runCurlRAF(() => {
        setCards(nextCards);  cardsRef.current  = nextCards;
        setPtr(nextPtr);      ptrRef.current    = nextPtr;
        setCardSeq(nextSeq);  cardSeqRef.current = nextSeq;
        if (_isNew) { setNewAnswer(""); newAnswerRef.current = ""; }
        afterTransition();
      });
    } else {
      /* ── tear: 빈 카드 → 1시 방향 날아가기 ──────── */
      setAnimType("tear");
      if (curlRaf.current !== null) cancelAnimationFrame(curlRaf.current);
      setRawProgress(0);
      const startTime = performance.now();
      const step = (now: number) => {
        const raw = (now - startTime) / TEAR_DURATION;
        setRawProgress(Math.min(raw, 1));
        if (raw < TEAR_FADE_DONE) {
          curlRaf.current = requestAnimationFrame(step);
        } else {
          /* opacity=0 도달 → 카드 교체 후 트랜지션 종료 */
          setCards(nextCards);  cardsRef.current  = nextCards;
          setPtr(nextPtr);      ptrRef.current    = nextPtr;
          setCardSeq(nextSeq);  cardSeqRef.current = nextSeq;
          if (_isNew) { setNewAnswer(""); newAnswerRef.current = ""; }
          afterTransition();
        }
      };
      curlRaf.current = requestAnimationFrame(step);
    }
  }, [runCurlRAF, afterTransition]);

  /* ════════════════════════════════════════════════════════════════
   * triggerBack — 이전 카드로 (back curl, reverse)
   *
   * rolledAmount = 1 - rawProgress:
   *   시작 시 이전 카드가 이미 "완전히 말린" 상태(rolledAmount=1)에서
   *   rawProgress가 0→1로 진행하면서 rolledAmount는 1→0으로 감소.
   *   → 이전 카드가 상단에서 아래로 펼쳐지며 나타남.
   *
   * 레이어 역할:
   *   base:      현재 카드 (아래에 고정)
   *   flat-grow: 이전 카드 (clipPath가 위→아래로 성장)
   *   flap:      이전 카드 상단부 (시작엔 가득, 점점 작아짐)
   * ════════════════════════════════════════════════════════════════ */
  const triggerBack = useCallback(() => {
    if (animatingRef.current) return;

    const _ptr   = ptrRef.current;
    const _cards = cardsRef.current;

    if (_ptr <= 0) {
      /* 이전 카드 없음: rubber-band 스냅백 */
      setCardTyTrans(`transform 400ms ${EASE_SNAP}`);
      setCardTY(0);
      return;
    }

    const isCurrentNew = _ptr === _cards.length;
    const outQ   = isCurrentNew
      ? QUESTIONS[cardSeqRef.current % QUESTIONS.length]
      : QUESTIONS[_cards[_ptr]?.qIdx ?? 0];
    const outAns = isCurrentNew ? newAnswerRef.current : (_cards[_ptr]?.answer ?? "");

    const prevCard = _cards[_ptr - 1];
    const prevQ    = QUESTIONS[prevCard.qIdx];

    setAnimating(true);
    animatingRef.current = true;
    setAnimDir("back");
    setOutgoingSnap({ question: outQ, answer: outAns });
    setIncoming({ question: prevQ, answer: prevCard.answer });

    runCurlRAF(() => {
      setPtr(_ptr - 1); ptrRef.current = _ptr - 1;
      afterTransition();
    });
  }, [runCurlRAF, afterTransition]);

  /* ─── Drag handlers ──────────────────────────────────────────── */
  const onStart = useCallback((clientY: number) => {
    if (animatingRef.current) return;
    dragging.current = true;
    startY.current   = clientY;
    lastDY.current   = 0;
  }, []);

  const onMove = useCallback((clientY: number) => {
    if (!dragging.current) return;
    const dy = clientY - startY.current;
    lastDY.current = dy;
    cancelAnimationFrame(dragRaf.current);
    dragRaf.current = requestAnimationFrame(() => {
      if (dy < 0) {
        setCardTyTrans("none");
        setCardTY(dy * 0.10);
      } else {
        setCardTyTrans("none");
        const canBack = ptrRef.current > 0;
        setCardTY(canBack ? dy * 0.12 : Math.min(dy * 0.22, REST_TY * 0.28));
      }
    });
  }, []);

  const onEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    cancelAnimationFrame(dragRaf.current);

    const dy     = lastDY.current;
    const THRESH = 80;

    if (dy < -THRESH) {
      const _isNew = ptrRef.current === cardsRef.current.length;
      const hasAns = _isNew ? newAnswerRef.current.trim().length > 0 : true;
      setCardTY(0); setCardTyTrans("none");
      triggerAdvance(hasAns);
    } else if (dy > THRESH) {
      setCardTY(0); setCardTyTrans("none");
      triggerBack();
    } else {
      setCardTyTrans(`transform 420ms ${EASE_SNAP}`);
      setCardTY(0);
    }
  }, [triggerAdvance, triggerBack]);

  /* mouse listeners */
  const onMouseDown = useCallback((e: React.MouseEvent) => onStart(e.clientY), [onStart]);
  useEffect(() => {
    const mv = (e: MouseEvent) => onMove(e.clientY);
    const up = () => onEnd();
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup",   up);
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup",   up);
    };
  }, [onMove, onEnd]);

  /* touch listeners */
  const onTouchStart = useCallback((e: React.TouchEvent) => onStart(e.touches[0].clientY), [onStart]);
  const onTouchMove  = useCallback((e: React.TouchEvent) => onMove(e.touches[0].clientY), [onMove]);
  const onTouchEnd   = useCallback(() => onEnd(), [onEnd]);

  /* cleanup on unmount */
  useEffect(() => {
    return () => {
      if (curlRaf.current !== null) cancelAnimationFrame(curlRaf.current);
      cancelAnimationFrame(dragRaf.current);
    };
  }, []);

  /* ─── Reset all ──────────────────────────────────────────────── */
  const resetAll = useCallback(() => {
    if (curlRaf.current !== null) cancelAnimationFrame(curlRaf.current);
    cancelAnimationFrame(dragRaf.current);
    dragging.current = false;
    animatingRef.current = false;
    setAnimating(false);
    setCards([]);  cardsRef.current  = [];
    setPtr(0);     ptrRef.current    = 0;
    setNewAnswer(""); newAnswerRef.current = "";
    setCardSeq(0); cardSeqRef.current = 0;
    setRawProgress(0);
    setCardTY(0); setCardTyTrans("none");
    setOutgoingSnap(null);
    setIncoming(null);
  }, []);

  /* ════════════════════════════════════════════════════════════════
   * Curl geometry (첨부 코드 그대로)
   *
   * forward: rolledAmount = rawProgress       (0→1, 말려 올라감)
   * back:    rolledAmount = 1 - rawProgress   (1→0, 위에서 펼쳐짐)
   * ════════════════════════════════════════════════════════════════ */
  const rolledAmount = !animating
    ? 0
    : animDir === "forward"
      ? rawProgress
      : 1 - rawProgress;

  const rolledRight = clamp01(Math.pow(rolledAmount, RIGHT_EXP));
  const rolledLeft  = clamp01(Math.pow(rolledAmount, LEFT_EXP));
  const flatFracRight  = 1 - rolledRight;
  const flatFracLeft   = 1 - rolledLeft;
  const flatHeightRight = SMALL_H * flatFracRight;
  const flatHeightLeft  = SMALL_H * flatFracLeft;
  const rollTopAvg  = (flatHeightRight + flatHeightLeft) / 2;
  const skewDeg = (Math.atan2(flatHeightRight - flatHeightLeft, SMALL_W) * 180) / Math.PI;

  /*
   * 레이어 콘텐츠 결정:
   *   forward: base=incoming(next),  flat/flap=outgoing(current)
   *   back:    base=outgoing(current), flat/flap=incoming(prev)
   */
  const baseQ   = animDir === "forward" ? (incoming?.question ?? "") : displayQ;
  const baseAns = animDir === "forward" ? (incoming?.answer   ?? "") : displayAnswer;
  const animQ   = animDir === "forward" ? displayQ                   : (incoming?.question ?? "");
  const animAns = animDir === "forward" ? displayAnswer              : (incoming?.answer   ?? "");

  /* curl 레이어를 렌더할 때만 true. tear 중에는 false → clip-wrapper가 incoming 정적 렌더 */
  const isCurling = animating && animType === "curl" && incoming !== null;

  /* ─── Render ─────────────────────────────────────────────────── */
  return (
    <>
      <style>{`::-webkit-scrollbar{width:0;height:0} textarea::placeholder{color:#d4d4d8}`}</style>

      <div style={{
        minHeight: "100vh", background: "#ebebeb",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 20, padding: "32px 16px", fontFamily: FONT,
      }}>

        {/* 레이블 */}
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: C.zinc600, margin: 0 }}>
            노트 질문 카드
          </p>
          <p style={{ fontSize: 11.5, color: C.zinc400, margin: "5px 0 0", lineHeight: 1.6 }}>
            ↑ 위 스와이프 · 다음 질문&nbsp;&nbsp;|&nbsp;&nbsp;↓ 아래 스와이프 · 이전 질문
          </p>
          <p style={{ fontSize: 10.5, color: "#bbb", margin: "3px 0 0" }}>
            {cards.length > 0
              ? `저장됨 ${cards.length}장 · ${isNewCard ? "새 카드" : `${ptr + 1}번`}`
              : "카드를 위로 스와이프하면 다음 질문으로 넘어갑니다"}
          </p>
        </div>

        {/* 폰 프레임 */}
        <div
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            width: PH_W, height: PH_H, borderRadius: 44, overflow: "hidden",
            background: "#1a1a1e",
            boxShadow: "0 0 0 2px #3a3a3e, 0 0 0 4px #28282c, 0 28px 90px rgba(0,0,0,0.55)",
            position: "relative", flexShrink: 0,
            cursor: animating ? "default" : "grab", userSelect: "none",
          }}
        >
          <StatusBar />

          {/* 리더 배경 */}
          <div style={{
            position: "absolute", inset: 0, background: C.white,
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ height: 48, flexShrink: 0 }} />
            <div style={{
              height: 52, flexShrink: 0, display: "flex",
              alignItems: "center", paddingLeft: 20,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: C.zinc50,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke={C.zinc600} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{
                width: PH_W, height: FULL_H, position: "relative",
                boxShadow: "0 -10px 28px rgba(0,0,0,0.07), 0 10px 28px rgba(0,0,0,0.07)",
              }}>
                <div style={{
                  position: "absolute", inset: 0,
                  padding: "28px 24px 44px",
                  display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  {[
                    "행복이란 거창한 것이 아니라는 걸, 비 오는 날은 늘 다시 일깨워 준다. 지금 이 자리, 이 온기, 이 고요함.",
                    "그것으로 충분하다.",
                    "이상으로 글을 마친다.",
                  ].map((line, i) => (
                    <p key={i} style={{
                      margin: "0 0 22px 0", fontSize: 16, fontFamily: SERIF,
                      fontWeight: 400, lineHeight: 1.85, letterSpacing: "0.05em",
                      color: i === 2 ? C.zinc400 : "#1a1a1a",
                      fontStyle: i === 2 ? "italic" : "normal",
                    }}>{line}</p>
                  ))}
                </div>
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0, height: 40,
                  borderTop: `1px solid ${C.zinc100}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: 12.5, fontFamily: FONT, color: C.zinc400 }}>
                    비 오는 날의 단상
                  </span>
                </div>
              </div>
            </div>
            <div style={{ height: 68, flexShrink: 0 }} />
          </div>

          {/* 딤 오버레이 */}
          <div style={{
            position: "absolute", inset: 0, zIndex: 40,
            background: "rgba(0,0,0,0.28)", pointerEvents: "none",
          }} />

          {/* ── 카드 레이어 ─────────────────────────────────────── */}
          <div style={{ position: "absolute", inset: 0, zIndex: 41 }}>

            {/* 노트패드 스택 깊이감 */}
            <div style={{
              position: "absolute",
              left: SMALL_LEFT - 2, width: SMALL_W,
              top: "50%", marginTop: -(SMALL_H / 2) + 7,
              height: SMALL_H, borderRadius: 20,
              background: "#ede8d8", zIndex: 0,
              boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
            }} />
            <div style={{
              position: "absolute",
              left: SMALL_LEFT - 1, width: SMALL_W,
              top: "50%", marginTop: -(SMALL_H / 2) + 3.5,
              height: SMALL_H, borderRadius: 20,
              background: "#f4f0e2", zIndex: 0,
              boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
            }} />

            {/* ════════════════════════════════════════════════════
             * 카드 컨테이너
             * overflow:visible → spring이 바깥으로 튀어나와도 됨.
             * 내부 clip-wrapper가 실제 overflow:hidden + borderRadius 담당.
             * ════════════════════════════════════════════════════ */}
            <div style={{
              position: "absolute",
              left: SMALL_LEFT, width: SMALL_W, height: SMALL_H,
              top: "50%", marginTop: -(SMALL_H / 2),
              transform: `translateY(${cardTY}px)`,
              transition: cardTyTrans,
              borderRadius: 20,
              boxShadow: "0 6px 44px rgba(0,0,0,0.18), 0 1px 8px rgba(0,0,0,0.1)",
              zIndex: 10,
              willChange: "transform",
              overflow: "visible",
            }}>

              {/* overflow:hidden 클리핑 래퍼 */}
              <div style={{
                position: "absolute", inset: 0,
                borderRadius: 20,
                overflow: "hidden",
              }}>
                {isCurling ? (
                  <>
                    {/* ─── 1. Base layer: 아래에서 대기하는 카드 ─────────
                     *   forward: 다음 카드
                     *   back:    현재 카드 (이전 카드에 덮임)
                     */}
                    <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
                      <CardFace question={baseQ} answer={baseAns} />
                    </div>

                    {/* ─── 2. Flat-remaining: clipPath로 잘려나가는 면 ──
                     *   forward: 현재 카드가 위로 잘려나감
                     *   back:    이전 카드가 위에서 아래로 성장
                     */}
                    <div style={{
                      position: "absolute",
                      top: 0, left: 0,
                      width: "100%", height: SMALL_H,
                      zIndex: 3,
                      clipPath: `polygon(0% 0%, 100% 0%, 100% ${flatFracRight * 100}%, 0% ${flatFracLeft * 100}%)`,
                    }}>
                      <CardFace question={animQ} answer={animAns} />
                    </div>

                    {/* ─── 3. Folded-flap: 분할선 아래(forward) 또는 위에서
                     *       펼쳐지는(back) 종이를 사선축으로 반사 ────────── */}
                    {/*
                     * 레이어 중첩 이유:
                     *   filter-wrapper   → drop-shadow를 둥근 모양에 적용
                     *   rounded-clip     → overflow:hidden + borderRadius로 모서리 먼저 둥글게 클립
                     *   transform-wrapper → 사선축 반사 transform
                     *   clip-div         → polygon clipPath (하단 밴드만 남김)
                     *
                     * 이 순서로 filter가 이미 둥근 카드 실루엣을 보고 shadow를 계산하므로
                     * 모서리 shadow도 카드 borderRadius와 동일하게 둥글게 렌더됨.
                     */}
                    <div style={{
                      position: "absolute",
                      top: 0, left: 0,
                      width: "100%", height: SMALL_H,
                      zIndex: 4,
                      filter: "drop-shadow(0 0 14px rgba(0,0,0,0.4))",
                      pointerEvents: "none",
                    }}>
                      {/* 둥근 모서리 클립: card의 borderRadius와 동일 → shadow가 둥글게 생성됨 */}
                      <div style={{
                        position: "absolute", inset: 0,
                        borderRadius: 20,
                        overflow: "hidden",
                      }}>
                        {/* 반사 transform */}
                        <div style={{
                          position: "absolute", inset: 0,
                          transformOrigin: `50% ${rollTopAvg}px`,
                          transform: `rotate(${skewDeg}deg) scaleY(-1) rotate(${-skewDeg}deg)`,
                          backfaceVisibility: "visible",
                        }}>
                          {/* polygon clipPath: 분할선 아래 밴드만 남김 */}
                          <div style={{
                            position: "absolute", inset: 0,
                            clipPath: `polygon(0% ${flatFracLeft * 100}%, 100% ${flatFracRight * 100}%, 100% 100%, 0% 100%)`,
                          }}>
                            {/* 뒷면: 흰 바탕만 */}
                            <div style={{ position: "absolute", inset: 0, background: C.white }} />
                            {/* 접혀 올라간 뒷면 음영 */}
                            <div style={{
                              position: "absolute", inset: 0,
                              pointerEvents: "none",
                              mixBlendMode: "multiply",
                              background: `linear-gradient(to bottom,
                                rgba(255,255,255,0.35) 0%,
                                rgba(0,0,0,0.15) 8%,
                                rgba(0,0,0,0.32) 55%,
                                rgba(0,0,0,0.5) 100%)`,
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ─── 4. Crease-shadow: 분할선 그림자 띠 ─────────────
                     *   taper로 완전히 말리거나 펼쳐지면 소멸.
                     */}
                    <div style={{
                      position: "absolute",
                      left: 0, width: "100%",
                      top: rollTopAvg,
                      height: 44,
                      zIndex: 5,
                      transform: `skewY(${skewDeg}deg)`,
                      transformOrigin: "50% 0%",
                      background: `linear-gradient(180deg,
                        rgba(0,0,0,${0.5 * taper(rolledAmount)}) 0%,
                        rgba(0,0,0,0) 100%)`,
                      pointerEvents: "none",
                    }} />
                  </>
                ) : animating && animType === "tear" && incoming ? (
                  /* tear 중: 다음 카드를 아래에 즉시 노출
                   * 날아가는 종이(outgoing)는 clip-wrapper 바깥에 별도 렌더됨 */
                  <CardFace question={incoming.question} answer={incoming.answer} />
                ) : (
                  /* 비-애니메이션: 현재 카드 정적 렌더 */
                  <CardFace question={displayQ} answer={displayAnswer} />
                )}
              </div>

              {/* 스프링 (overflow 바깥, 항상 최상단) */}
              <SpringCoil />

              {/* ── Tear: 1시 방향으로 날아가는 종이 ────────────────────
               * card-container는 overflow:visible이므로 폰 프레임 밖까지 이동 가능.
               * SpringCoil(zIndex:10)보다 위인 zIndex:20으로 스프링 위를 지나 날아감.
               * flyOpacity가 0이 되기 전에 폰 테두리에 닿으므로 클리핑은 시각적으로 무관.
               * ──────────────────────────────────────────────────────── */}
              {animating && animType === "tear" && outgoingSnap && (() => {
                const tearEased  = easeOutCubic(rawProgress);
                const flyX       = tearEased * 460;
                const flyY       = tearEased * -760;
                const flyRot     = tearEased * 38;
                const flyScale   = 1 - tearEased * 0.22;
                const flyOpacity = Math.max(0, 1 - rawProgress / TEAR_FADE_DONE);
                return (
                  <div style={{
                    position: "absolute", inset: 0,
                    zIndex: 20,
                    clipPath: TORN_TOP_CLIP,
                    transformOrigin: "50% 0%",
                    transform: `translate(${flyX}px, ${flyY}px) rotate(${flyRot}deg) scale(${flyScale})`,
                    opacity: flyOpacity,
                    filter: "drop-shadow(-10px 14px 18px rgba(0,0,0,0.35))",
                    willChange: "transform, opacity",
                    pointerEvents: "none",
                  }}>
                    <CardFace question={outgoingSnap.question} answer={outgoingSnap.answer} />
                  </div>
                );
              })()}

            </div>

            {/* InteractiveOverlay (투명 텍스트 + caret, 입력 전담) */}
            <InteractiveOverlay
              ty={cardTY}
              question={displayQ}
              answer={displayAnswer}
              editable={!animating && isNewCard}
              onChange={handleAnswerChange}
              zIndex={30}
            />

          </div>

          {/* ↑/↓ 버튼 */}
          <div style={{
            position: "absolute", bottom: 28, left: 0, right: 0,
            zIndex: 50, display: "flex", justifyContent: "center", gap: 16,
            pointerEvents: "none",
          }}>
            {([
              ["↓", triggerBack, "이전 질문"],
              ["↑", () => {
                if (animatingRef.current) return;
                const _isNew = ptrRef.current === cardsRef.current.length;
                triggerAdvance(_isNew ? newAnswerRef.current.trim().length > 0 : true);
              }, "다음 질문"],
            ] as const).map(([label, fn, aria]) => (
              <button
                key={label as string}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={fn as () => void}
                aria-label={aria as string}
                style={{
                  pointerEvents: "auto",
                  width: 44, height: 44, borderRadius: 999,
                  background: "rgba(255,255,255,0.9)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                  cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center",
                  fontSize: 18, color: C.zinc700,
                }}
              >{label}</button>
            ))}
          </div>

          {/* 초기화 버튼 */}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={resetAll}
            style={{
              position: "absolute", top: 60, right: 18, zIndex: 52,
              padding: "4px 10px", borderRadius: 8,
              background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: C.white, fontSize: 10.5, fontFamily: FONT, cursor: "pointer",
            }}
          >초기화</button>

        </div>
      </div>
    </>
  );
}

/* ─── QUESTIONS ───────────────────────────────────────────────────── */
const QUESTIONS = [
  "작성자가 하고자 하는 말은 무엇이었나요?",
  "이 글을 읽고 떠오르는 다른 글이나 경험이 있다면 무엇인가요?",
  "이 글을 읽기 전과 읽은 후, 당신의 생각이 가장 크게 바뀐 지점은 어디인가요?",
];
