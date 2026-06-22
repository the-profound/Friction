import { useRef, useState, useCallback, useEffect } from "react";

/* ─── Tokens ─────────────────────────────────────────────────────── */
const C = {
  zinc900: "#18181b", zinc800: "#27272a", zinc700: "#3f3f46",
  zinc600: "#52525b", zinc500: "#71717a", zinc400: "#a1a1aa",
  zinc300: "#d4d4d8", zinc200: "#e4e4e7", zinc100: "#f4f4f5",
  zinc50: "#fafafa", white: "#ffffff",
};
const FONT  = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const SERIF = "'Eulyoo1945-Regular',Georgia,serif";

/* ─── Layout ──────────────────────────────────────────────────────── */
const PH_W = 390;
const PH_H = 844;
const CARD_W = PH_W;
const CARD_H = Math.round(CARD_W * (8 / 5)); // 624

const SMALL_W    = Math.round(CARD_W * 0.84);
const SMALL_H    = Math.round(CARD_H * 0.84);
const SMALL_LEFT = Math.round((PH_W - SMALL_W) / 2);
const REST_TX    = PH_W - SMALL_LEFT;
const OVERLAY_RADIUS = 20;
const COMMIT_THRESHOLD = 80;

/* ─── Transitions ─────────────────────────────────────────────────── */
const SPRING     = "transform 0.48s cubic-bezier(0.34,1.36,0.64,1)";
const SNAP       = "transform 0.36s cubic-bezier(0.25,0.46,0.45,0.94)";
/* "Same grid" horizontal slide — no fade, both cards use identical easing */
const EXIT_SLIDE = "transform 0.42s cubic-bezier(0.25,0.46,0.45,0.94)";
const ENTER_GRID = "transform 0.42s cubic-bezier(0.25,0.46,0.45,0.94)";
/* Fly-away — steeper initial slope so motion starts immediately */
const EXIT_FLY   = "transform 0.46s cubic-bezier(0.4,0,1,0.55), opacity 0.32s cubic-bezier(0.4,0,1,0.55)";
const ENTER      = "transform 0.48s cubic-bezier(0.34,1.36,0.64,1)";

/* ─── Rotating questions ──────────────────────────────────────────── */
const QUESTIONS = [
  "이 글에서 인상적인 내용은 무엇이었나요?",
  "이 글을 읽으며 어떤 감정이 들었나요?",
  "이 글에서 가장 공감되는 부분이 있었나요?",
  "이 글이 당신에게 남긴 한 문장은 무엇인가요?",
];

/* ─── Types ───────────────────────────────────────────────────────── */
interface CardEntry { qIdx: number; answer: string; }

/* ─── Static article content ──────────────────────────────────────── */
const LAST_PAGE_LINES = [
  "행복이란 거창한 것이 아니라는 걸, 비 오는 날은 늘 다시 일깨워 준다. 지금 이 자리, 이 온기, 이 고요함.",
  "그것으로 충분하다.",
  "이상으로 글을 마친다.",
];

/* ─── Status bar ──────────────────────────────────────────────────── */
function StatusBar() {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 48,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 22px 0", zIndex: 20, pointerEvents: "none",
    }}>
      <span style={{ fontSize: 12, fontFamily: FONT, fontWeight: 600, color: C.white }}>9:41</span>
      <div style={{
        position: "absolute", left: "50%", top: 10, transform: "translateX(-50%)",
        width: 120, height: 32, background: "#000", borderRadius: 20,
      }}/>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <svg width="16" height="12" viewBox="0 0 16 12" fill={C.white}>
          <rect x="0" y="6" width="3" height="6" rx="0.5"/>
          <rect x="4" y="4" width="3" height="8" rx="0.5"/>
          <rect x="8" y="2" width="3" height="10" rx="0.5"/>
          <rect x="12" y="0" width="3" height="12" rx="0.5"/>
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0" y="1" width="21" height="10" rx="2" stroke={C.white} strokeWidth="1.2"/>
          <rect x="22" y="4" width="2" height="4" rx="1" fill={C.white} opacity="0.5"/>
          <rect x="1.5" y="2.5" width="17" height="7" rx="1.2" fill={C.white}/>
        </svg>
      </div>
    </div>
  );
}

/* ─── Question card ───────────────────────────────────────────────── */
function QuestionCard({
  question, answer, onChange,
}: {
  question: string; answer: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{
      width: "100%", height: "100%", background: C.white,
      display: "flex", flexDirection: "column",
      padding: "28px 26px 24px", boxSizing: "border-box",
    }}>
      <h3 style={{
        margin: "0 0 20px 0", fontSize: 18, fontFamily: SERIF, fontWeight: 400,
        color: C.zinc900, lineHeight: 1.55, letterSpacing: "0.02em",
      }}>
        {question}
      </h3>

      <textarea
        value={answer}
        onChange={(e) => onChange(e.target.value)}
        placeholder="생각을 자유롭게 적어보세요..."
        style={{
          flex: 1, border: "none", outline: "none", resize: "none",
          background: "transparent", padding: 0,
          fontSize: 15, fontFamily: SERIF,
          color: C.zinc700, lineHeight: 1.9, letterSpacing: "0.03em",
        }}
      />
    </div>
  );
}

/* ─── Card shell (positioning + shadow) ──────────────────────────── */
function CardShell({
  transform, transition, opacity = 1, zIndex = 10, children,
}: {
  transform: string; transition: string;
  opacity?: number; zIndex?: number; children: React.ReactNode;
}) {
  return (
    <div style={{
      position: "absolute",
      top: "50%", marginTop: -(SMALL_H / 2),
      width: SMALL_W, height: SMALL_H, left: SMALL_LEFT,
      transform, transition,
      opacity, willChange: "transform, opacity",
      borderRadius: OVERLAY_RADIUS,
      background: C.white,
      boxShadow: "0 4px 40px rgba(0,0,0,0.16), 0 1px 8px rgba(0,0,0,0.08)",
      overflow: "hidden", zIndex,
    }}>
      {children}
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────── */
export default function ReaderSwipeNextPreview() {
  /* history stack — only saved (non-discarded) cards */
  const [cards, setCards]       = useState<CardEntry[]>([]);
  /* ptr: -1=article, 0..cards.length-1=saved card, cards.length=new card */
  const [ptr, setPtr]           = useState(-1);
  /* live answer for the new card (ptr === cards.length) */
  const [newAnswer, setNewAnswer] = useState("");
  /* how many new-card slots have been generated (incl. discarded), drives question cycling */
  const [cardSeq, setCardSeq]   = useState(0);

  /* drag / animation */
  const [dragX, setDragX]         = useState(0);
  const [animating, setAnimating] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [exitDir, setExitDir]     = useState<null | "left-slide" | "fly" | "right-slide">(null);
  const [advanceDrag, setAdvanceDrag] = useState(0);
  const [backDrag, setBackDrag]       = useState(0); // nudge for back-swipe when prev card exists
  /* article horizontal offset for back-to-article slide-in animation */
  const [articleOffsetX, setArticleOffsetX]   = useState(0);
  const [articleSliding, setArticleSliding]   = useState(false);

  /* incoming card during a transition */
  const [incoming, setIncoming] = useState<{
    question: string; answer: string; fromLeft: boolean;
  } | null>(null);
  const [incomingIn, setIncomingIn] = useState(false);

  const dragging     = useRef(false);
  const startX       = useRef(0);
  const lastDisplace = useRef(0);
  const raf          = useRef<number>(0);

  /* ── derived ─────────────────────────────────────────────────────── */
  const isNewCard     = ptr === cards.length;
  const isCardVisible = ptr >= 0;
  /* new card uses cardSeq so discarded cards advance the question rotation */
  const currentQIdx   = isNewCard ? cardSeq % QUESTIONS.length : (cards[ptr]?.qIdx ?? 0);
  const currentQ      = QUESTIONS[currentQIdx];
  const currentAnswer = isNewCard ? newAnswer : (cards[ptr]?.answer ?? "");

  function handleAnswerChange(v: string) {
    if (isNewCard) {
      setNewAnswer(v);
    } else {
      setCards((prev) => prev.map((c, i) => i === ptr ? { ...c, answer: v } : c));
    }
  }

  /* ── dev reset ───────────────────────────────────────────────────── */
  const resetAll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    dragging.current = false;
    setDragX(0); setAnimating(false); setCommitted(false);
    setCards([]); setPtr(-1); setNewAnswer(""); setCardSeq(0);
    setExitDir(null); setAdvanceDrag(0); setBackDrag(0);
    setIncoming(null); setIncomingIn(false);
    setArticleOffsetX(0); setArticleSliding(false);
  }, []);

  /* ── advance: swipe forward (raw < 0) ───────────────────────────── */
  const triggerAdvance = useCallback((hasAnswer: boolean) => {
    setAdvanceDrag(0);
    setAnimating(true);

    const _isNewCard = ptr === cards.length;
    let nextCards  = cards;
    let nextPtr: number;
    let exitMode: "left-slide" | "fly";
    let nextSeq = cardSeq; // will increment if coming from a new card

    if (_isNewCard) {
      nextSeq = cardSeq + 1; // always bump sequence (whether saved or discarded)
      if (hasAnswer) {
        const entry: CardEntry = { qIdx: cardSeq % QUESTIONS.length, answer: newAnswer };
        nextCards = [...cards, entry];
        nextPtr   = nextCards.length; // new empty slot
        exitMode  = "left-slide";
      } else {
        nextPtr  = cards.length; // discard — same slot index, new sequence
        exitMode = "fly";
      }
    } else {
      nextPtr  = ptr + 1;
      exitMode = "left-slide";
    }

    setExitDir(exitMode);

    /* incoming card question: next sequence for new cards, stored qIdx for saved cards */
    let nextQ: string;
    let nextAnswer: string;
    if (nextPtr < nextCards.length) {
      nextQ      = QUESTIONS[nextCards[nextPtr].qIdx];
      nextAnswer = nextCards[nextPtr].answer;
    } else {
      nextQ      = QUESTIONS[nextSeq % QUESTIONS.length];
      nextAnswer = "";
    }
    setIncoming({ question: nextQ, answer: nextAnswer, fromLeft: false });

    if (exitMode === "left-slide") {
      /*
       * "Same grid" slide: both cards animate simultaneously.
       * Incoming starts on the very next frame so there is no gap.
       */
      requestAnimationFrame(() => {
        setCards(nextCards);
        setPtr(nextPtr);
        if (_isNewCard) setCardSeq(nextSeq);
        if (nextPtr === nextCards.length) setNewAnswer("");
        setIncomingIn(true);
        setTimeout(() => {
          setExitDir(null);
          setIncoming(null);
          setIncomingIn(false);
          setDragX(-SMALL_W);
          setCommitted(true);
          setAnimating(false);
        }, 460);
      });
    } else {
      /* fly: current card flies away first, then new card enters */
      setTimeout(() => {
        setCards(nextCards);
        setPtr(nextPtr);
        if (_isNewCard) setCardSeq(nextSeq);
        setNewAnswer("");
        setIncomingIn(true);
        setTimeout(() => {
          setExitDir(null);
          setIncoming(null);
          setIncomingIn(false);
          setDragX(-SMALL_W);
          setCommitted(true);
          setAnimating(false);
        }, 120);
      }, 360);
    }
  }, [cards, ptr, newAnswer, cardSeq]);

  /* ── back: swipe backward (raw > 0) ─────────────────────────────── */
  const triggerBack = useCallback(() => {
    const targetPtr = ptr - 1;
    setAdvanceDrag(0);
    setBackDrag(0);
    setAnimating(true);

    if (targetPtr >= 0) {
      /*
       * Card→card back: symmetric mirror of forward.
       * Current card exits RIGHT (right-slide), previous card enters from LEFT —
       * both moving simultaneously with the same EXIT_SLIDE easing.
       */
      const prev = cards[targetPtr];
      setIncoming({ question: QUESTIONS[prev.qIdx], answer: prev.answer, fromLeft: true });

      requestAnimationFrame(() => {
        /* start both motions on the same frame so they're in sync */
        setPtr(targetPtr);
        setIncomingIn(true);
        setExitDir("right-slide"); // current card exits right
        setTimeout(() => {
          setIncoming(null);
          setIncomingIn(false);
          setExitDir(null);
          setDragX(-SMALL_W);
          setCommitted(true);
          setAnimating(false);
        }, 460); // match EXIT_SLIDE 0.42 s
      });
    } else {
      /*
       * Last card → back to article: horizontal slide (reverse of forward).
       * Card exits RIGHT, article enters from LEFT simultaneously.
       */
      setExitDir("right-slide");
      /* position article off-screen left (no transition yet) */
      setArticleOffsetX(-REST_TX);
      /* also clear committed/dragX so scale/dim resets cleanly */
      setCommitted(false);
      setDragX(0);

      /* two rAFs to ensure the off-screen paint lands before transition starts */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setArticleSliding(true);
          setArticleOffsetX(0); // article slides in from left
          setTimeout(() => {
            setPtr(-1);
            setExitDir(null);
            setArticleOffsetX(0);
            setArticleSliding(false);
            setAnimating(false);
          }, 460);
        });
      });
    }
  }, [ptr, cards]);

  /* ── drag handlers ───────────────────────────────────────────────── */
  const onStart = useCallback((clientX: number) => {
    if (animating || incoming !== null) return;
    /* Bug fix: show the card slot immediately so the first drag has something to animate */
    if (!committed && ptr === -1) {
      /* start from the oldest saved card (ptr=0); if none, that equals cards.length (new slot) */
      setPtr(0);
    }
    dragging.current     = true;
    startX.current       = clientX;
    lastDisplace.current = 0;
  }, [animating, incoming, committed, ptr, cards.length]);

  const onMove = useCallback((clientX: number) => {
    if (!dragging.current) return;
    const raw = clientX - startX.current;
    lastDisplace.current = raw;
    cancelAnimationFrame(raf.current);

    if (committed) {
      if (raw < 0) {
        /* advance hint: card nudges left */
        setBackDrag(0);
        raf.current = requestAnimationFrame(() =>
          setAdvanceDrag(Math.max(raw, -COMMIT_THRESHOLD * 1.2))
        );
      } else {
        /* back hint */
        setAdvanceDrag(0);
        if (ptr > 0) {
          /* previous card exists: nudge current card right only — do NOT touch dragX
           * so the article never peeks through */
          raf.current = requestAnimationFrame(() =>
            setBackDrag(Math.min(raw, COMMIT_THRESHOLD * 1.2))
          );
        } else {
          /* no previous card: article peeks (original dismiss behaviour) */
          setBackDrag(0);
          const newDragX = Math.min(0, Math.max(-SMALL_W, -SMALL_W + raw));
          raf.current = requestAnimationFrame(() => setDragX(newDragX));
        }
      }
    } else {
      /* opening: left-only */
      const newDragX = Math.min(0, Math.max(-SMALL_W, raw));
      raf.current = requestAnimationFrame(() => setDragX(newDragX));
    }
  }, [committed, ptr]);

  const onEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    cancelAnimationFrame(raf.current);
    const d = lastDisplace.current;
    setAnimating(true);

    if (committed) {
      if (d < 0 && -d >= COMMIT_THRESHOLD) {
        /* forward */
        const _isNew   = ptr === cards.length;
        const hasAnswer = _isNew ? newAnswer.trim().length > 0 : true;
        triggerAdvance(hasAnswer);
      } else if (d > 0 && d >= COMMIT_THRESHOLD) {
        /* back */
        triggerBack();
      } else {
        setAdvanceDrag(0);
        setBackDrag(0);
        setDragX(-SMALL_W);
        setTimeout(() => setAnimating(false), 400);
      }
    } else {
      if (-d >= COMMIT_THRESHOLD) {
        setDragX(-SMALL_W);
        setCommitted(true);
        setTimeout(() => setAnimating(false), 500);
      } else {
        /* snap back — also close the card slot if we just opened from article */
        setDragX(0);
        setTimeout(() => {
          setPtr((p) => (p === cards.length && !committed ? -1 : p));
          setAnimating(false);
        }, 380);
      }
    }
  }, [committed, ptr, cards, newAnswer, triggerAdvance, triggerBack]);

  /* mouse */
  const onMouseDown = useCallback((e: React.MouseEvent) => onStart(e.clientX), [onStart]);
  useEffect(() => {
    const mv = (e: MouseEvent) => onMove(e.clientX);
    const up = () => onEnd();
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [onMove, onEnd]);

  /* touch */
  const onTouchStart = useCallback((e: React.TouchEvent) => onStart(e.touches[0].clientX), [onStart]);
  const onTouchMove  = useCallback((e: React.TouchEvent) => onMove(e.touches[0].clientX), [onMove]);
  const onTouchEnd   = useCallback(() => onEnd(), [onEnd]);

  /* ── derived visuals ─────────────────────────────────────────────── */
  const progress  = Math.min(1, Math.max(0, Math.abs(dragX) / SMALL_W));
  const pageScale = 1 - progress * 0.03;
  const dimAlpha  = progress * 0.28;

  const baseOverlayTx = REST_TX + dragX * (REST_TX / SMALL_W);

  /* current card transform */
  let cardTransform: string;
  let cardTransition: string;
  let cardOpacity = 1;

  if (exitDir === "left-slide") {
    /* symmetric with incoming start position — pure translate, no fade */
    cardTransform  = `translateX(${-REST_TX}px)`;
    cardTransition = EXIT_SLIDE;
    cardOpacity    = 1;
  } else if (exitDir === "fly") {
    cardTransform  = `translateX(-200px) translateY(-380px) rotate(22deg)`;
    cardTransition = EXIT_FLY;
    cardOpacity    = 0;
  } else if (exitDir === "right-slide") {
    /* symmetric mirror of left-slide — exits off the right edge */
    cardTransform  = `translateX(${REST_TX}px)`;
    cardTransition = EXIT_SLIDE;
    cardOpacity    = 1;
  } else {
    cardTransform  = `translateX(${baseOverlayTx + advanceDrag * 0.14 + backDrag * 0.14}px)`;
    cardTransition = animating ? (committed ? SPRING : SNAP) : "none";
  }

  /* incoming card transform + transition */
  const incomingBaseTx  = incoming?.fromLeft ? -REST_TX : REST_TX;
  const incomingTx      = incomingIn ? 0 : incomingBaseTx;
  /* forward slide: same easing as EXIT_SLIDE; back-nav: spring */
  const incomingEnter   = ENTER_GRID; // same ease for both directions

  const pageTransition = animating
    ? `transform ${committed ? "0.48s" : "0.36s"} ease, opacity ${committed ? "0.48s" : "0.36s"} ease`
    : "none";

  return (
    <div style={{
      minHeight: "100vh", background: "#ebebeb",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 20, padding: "32px 16px", fontFamily: FONT,
    }}>
      {/* label */}
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 13, fontFamily: FONT, fontWeight: 600, color: C.zinc600, margin: 0 }}>
          글 읽기 — 마지막 페이지 Over-swipe
        </p>
        <p style={{ fontSize: 11.5, fontFamily: FONT, color: C.zinc400, margin: "5px 0 0", lineHeight: 1.6 }}>
          ← 카드 열기 · 카드 위에서 ← 다음 · → 이전
        </p>
        {isCardVisible && (
          <p style={{ fontSize: 11, fontFamily: FONT, color: C.zinc400, margin: "3px 0 0" }}>
            저장됨 {cards.length}장
            {ptr >= 0 && ptr < cards.length && ` · ${ptr + 1}번 카드 보는 중`}
            {isNewCard && ` · 새 카드`}
          </p>
        )}
      </div>

      {/* phone frame */}
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
          cursor: "grab", userSelect: "none",
        }}
      >
        <StatusBar />

        {/* reader base */}
        <div style={{
          position: "absolute", inset: 0, background: C.white,
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ height: 48, flexShrink: 0 }}/>

          {/* header */}
          <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", paddingLeft: 20 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: C.zinc50,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke={C.zinc600} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </div>
          </div>

          {/* card area */}
          <div style={{
            flex: 1, position: "relative", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* article page */}
            <div style={{
              width: CARD_W, height: CARD_H, position: "relative",
              boxShadow: "0 -10px 28px rgba(0,0,0,0.07), 0 10px 28px rgba(0,0,0,0.07)",
              transform: `translateX(${articleOffsetX}px) scale(${pageScale})`,
              transition: articleSliding ? EXIT_SLIDE : pageTransition,
              willChange: "transform",
            }}>
              <div style={{
                position: "absolute", inset: 0, padding: "28px 24px 44px",
                display: "flex", flexDirection: "column", justifyContent: "center",
              }}>
                {LAST_PAGE_LINES.map((line, i) => (
                  <p key={i} style={{
                    margin: "0 0 22px 0", fontSize: 16, fontFamily: SERIF, fontWeight: 400,
                    color: i === 2 ? C.zinc400 : "#1a1a1a",
                    lineHeight: 1.85, letterSpacing: "0.05em",
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
              <div style={{
                position: "absolute", inset: 0,
                background: `rgba(0,0,0,${dimAlpha})`,
                transition: pageTransition, pointerEvents: "none",
              }}/>
            </div>

            {/* current card */}
            {isCardVisible && (
              <CardShell
                transform={cardTransform}
                transition={cardTransition}
                opacity={cardOpacity}
                zIndex={10}
              >
                <QuestionCard
                  question={currentQ}
                  answer={currentAnswer}
                  onChange={handleAnswerChange}
                />
              </CardShell>
            )}

            {/* incoming card (during transition) */}
            {incoming !== null && (
              <CardShell
                transform={`translateX(${incomingTx}px)`}
                transition={incomingIn ? incomingEnter : "none"}
                zIndex={9}
              >
                <QuestionCard
                  question={incoming.question}
                  answer={incoming.answer}
                  onChange={() => {}}
                />
              </CardShell>
            )}
          </div>

          {/* bottom bar */}
          <div style={{
            height: 68, flexShrink: 0, background: C.white,
            display: "flex", alignItems: "center", paddingLeft: 24, paddingRight: 88,
          }}>
            <div style={{ flex: 1, height: 2, borderRadius: 1, background: C.zinc200, overflow: "hidden" }}>
              <div style={{ width: "100%", height: "100%", background: C.zinc900, borderRadius: 1 }}/>
            </div>
          </div>
        </div>
      </div>

      {/* dev reset */}
      <button
        onClick={resetAll}
        style={{
          padding: "7px 18px", borderRadius: 8,
          background: C.white, border: `1px solid ${C.zinc200}`,
          cursor: "pointer", fontSize: 12, fontFamily: FONT,
          color: C.zinc500, letterSpacing: "0.03em",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}
      >
        ↺ 초기화
      </button>

      {/* legend */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { icon: "←", label: "왼쪽 드래그",  sub: "카드 열기" },
          { icon: "←✍", label: "답변 후 ←",   sub: "저장 + 다음 카드" },
          { icon: "←✕", label: "공란 후 ←",   sub: "버림 + 다음 카드" },
          { icon: "→",  label: "오른쪽 드래그", sub: "이전 카드 / 원래 글" },
        ].map(({ icon, label, sub }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{
              width: 36, height: 34, borderRadius: 9,
              background: C.white, border: `1px solid ${C.zinc200}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}>{icon}</span>
            <span style={{ fontSize: 11, fontFamily: FONT, fontWeight: 600, color: C.zinc700 }}>{label}</span>
            <span style={{ fontSize: 10, fontFamily: FONT, color: C.zinc400 }}>{sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
