import { useState } from "react";
import readAllImg from "@/assets/read-all.png";
import readAllAnsweredImg from "@/assets/read-all-answered.png";

/* ─── Tokens ─────────────────────────────────────────────────────── */
const C = {
  zinc900: "#18181b", zinc800: "#27272a", zinc700: "#3f3f46",
  zinc600: "#52525b", zinc500: "#71717a", zinc400: "#a1a1aa",
  zinc300: "#d4d4d8", zinc200: "#e4e4e7", zinc100: "#f4f4f5",
  zinc50:  "#fafafa", white:   "#ffffff",
};
const GRAPHIC = "#5B3D4D";
const FONT    = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const SERIF   = "'Noto Serif KR','Noto Serif','Georgia',serif";

const PH_W = 390;
const PH_H = 844;

/* ─── Sample folders ──────────────────────────────────────────────── */
const SAMPLE_FOLDERS = [
  { id: "1", name: "인상 모음",  count: 12 },
  { id: "2", name: "연구 자료",  count:  8 },
  { id: "3", name: "일상 기록",  count: 24 },
  { id: "4", name: "읽을거리",   count:  5 },
  { id: "5", name: "강의 메모",  count: 17 },
];

/* ─── Status bar ──────────────────────────────────────────────────── */
function StatusBar() {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 52,
      display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      padding: "0 26px 10px", zIndex: 20, pointerEvents: "none",
    }}>
      <span style={{ fontSize: 12, fontFamily: FONT, fontWeight: 600, color: C.zinc900 }}>9:41</span>
      <div style={{
        position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)",
        width: 118, height: 34, background: "#000", borderRadius: 20,
      }}/>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <svg width="16" height="11" viewBox="0 0 16 11" fill={C.zinc900}>
          <rect x="0" y="5" width="3" height="6" rx="0.5"/>
          <rect x="4.5" y="3" width="3" height="8" rx="0.5"/>
          <rect x="9"   y="1" width="3" height="10" rx="0.5"/>
        </svg>
        <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
          <rect x="0" y="1" width="20" height="10" rx="2" stroke={C.zinc900} strokeWidth="1.2"/>
          <rect x="21" y="4" width="2" height="4" rx="1" fill={C.zinc900} opacity="0.5"/>
          <rect x="1.5" y="2.5" width="15" height="7" rx="1" fill={C.zinc900}/>
        </svg>
      </div>
    </div>
  );
}

/* ─── Calligraphic f ──────────────────────────────────────────────── */
function CalligraphicF() {
  /*
   * Stroke-based italic calligraphic f matching the reference image.
   * Parts: top hook sweeping right, diagonal stem, thin crossbar, bottom curl.
   * Variable stroke widths simulate calligraphic pen pressure.
   */
  return (
    <svg
      width="110" height="150"
      viewBox="0 0 100 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ── Top hook: curves up-right then swoops back left into the stem */}
      <path
        d="M 38 35 C 38 22 44 10 54 6 C 64 2 76 6 80 16 C 84 26 80 38 70 44 C 64 47 56 46 52 42"
        stroke={GRAPHIC} strokeWidth="4.5"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {/* ── Main italic stem: from top-hook join, descending to bottom */}
      <path
        d="M 42 32 C 43 60 45 90 46 128"
        stroke={GRAPHIC} strokeWidth="6"
        strokeLinecap="round"
      />
      {/* ── Crossbar: sits at ~45% height, extends left of stem more than right */}
      <path
        d="M 18 76 L 68 72"
        stroke={GRAPHIC} strokeWidth="3.5"
        strokeLinecap="round"
      />
      {/* ── Bottom curl: the descender tip curls gently to the right */}
      <path
        d="M 46 126 C 50 136 60 140 70 135"
        stroke={GRAPHIC} strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─── Fountain pen nib ────────────────────────────────────────────── */
function FountainPenNib() {
  const cx = 50;
  return (
    <svg width="100" height="150" viewBox="0 0 100 155" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Barrel: rounded top cap */}
      <rect x={cx - 16} y="5" width="32" height="28" rx="10" fill={GRAPHIC}/>

      {/* Grip: slightly tapered body connecting barrel to nib section */}
      <path d={`M ${cx-14} 33 L ${cx+14} 33 L ${cx+11} 70 L ${cx-11} 70 Z`} fill={GRAPHIC}/>

      {/* Collar ring at base of grip */}
      <rect x={cx-16} y="65" width="32" height="8" rx="4" fill={GRAPHIC}/>

      {/* Nib wings: symmetrical spearhead spreading below grip */}
      <path
        d={[
          `M ${cx-11} 73`,
          `L ${cx-26} 104`,
          `Q ${cx-18} 126 ${cx} 142`,
          `Q ${cx+18} 126 ${cx+26} 104`,
          `L ${cx+11} 73`,
          "Z",
        ].join(" ")}
        fill={GRAPHIC}
      />

      {/* Subtle highlight on nib face */}
      <path
        d={[
          `M ${cx-7} 77`, `L ${cx+7} 77`,
          `Q ${cx+9} 98 ${cx+3} 112`,
          `Q ${cx} 120 ${cx-3} 112`,
          `Q ${cx-9} 98 ${cx-7} 77`, "Z",
        ].join(" ")}
        fill="rgba(255,255,255,0.10)"
      />

      {/* Vent hole */}
      <circle cx={cx} cy="102" r="5" fill={C.white}/>

      {/* Centre slit from grip bottom to near tip */}
      <rect x={cx - 1.4} y="72" width="2.8" height="66" rx="1.4" fill={C.white}/>
    </svg>
  );
}

/* ─── Small icons ─────────────────────────────────────────────────── */
function FolderIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
function ChevronRight({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

/* ─── Phone screen ────────────────────────────────────────────────── */
type Case = "read" | "answered";

function Phone({ caseType }: { caseType: Case }) {
  const [selectedFolder] = useState(SAMPLE_FOLDERS[0]);

  const message = caseType === "read"
    ? "마지막 장까지\n온전히 닿았습니다."
    : "마지막 장을\n직접 완성했습니다.";

  return (
    <div style={{
      width: PH_W, height: PH_H,
      borderRadius: 50,
      background: "linear-gradient(145deg, #e8e6e1 0%, #d2cfc9 40%, #c4c1bb 70%, #d8d5cf 100%)",
      boxShadow: [
        "0 0 0 1.5px rgba(255,255,255,0.65)",
        "0 0 0 3px #aeaca6",
        "0 0 0 4px rgba(255,255,255,0.3)",
        "0 32px 80px rgba(0,0,0,0.28)",
        "0 8px 20px rgba(0,0,0,0.12)",
        "inset 0 0 0 1px rgba(255,255,255,0.4)",
      ].join(", "),
      padding: 10,
      position: "relative", flexShrink: 0,
    }}>
      {/* screen — pure white */}
      <div style={{
        width: "100%", height: "100%",
        borderRadius: 42, overflow: "hidden",
        background: C.white,
        position: "relative",
      }}>
        <StatusBar />

        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ height: 52, flexShrink: 0 }}/>

          {/* top: icon + message */}
          <div style={{
            flex: 1,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 28, padding: "0 36px",
          }}>
            <img
              src={caseType === "read" ? readAllImg : readAllAnsweredImg}
              alt=""
              style={{ width: 130, height: 130, objectFit: "contain" }}
            />

            <p style={{
              margin: 0,
              fontSize: 21, fontFamily: SERIF, fontWeight: 400,
              color: C.zinc800, lineHeight: 1.75,
              letterSpacing: "0.02em", textAlign: "center",
              whiteSpace: "pre-line",
            }}>
              {message}
            </p>
          </div>

          {/* bottom: original button layout */}
          <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* folder selector row */}
            <button style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "14px 16px",
              background: C.zinc50, border: `1px solid ${C.zinc200}`,
              borderRadius: 14, cursor: "pointer",
              textAlign: "left", marginBottom: 4,
            }}>
              <FolderIcon color={C.zinc500} />
              <span style={{
                flex: 1, fontSize: 14, fontFamily: FONT, fontWeight: 500,
                color: C.zinc700, letterSpacing: "0.01em",
              }}>
                {selectedFolder.name}
              </span>
              <ChevronRight color={C.zinc400} />
            </button>

            {/* 보관하기 — primary */}
            <button style={{
              width: "100%", padding: "15px 0",
              background: C.zinc900, border: "none",
              borderRadius: 14, cursor: "pointer",
              fontSize: 15, fontFamily: FONT, fontWeight: 600,
              color: C.white, letterSpacing: "0.01em",
            }}>
              보관하기
            </button>

            {/* 나가기 — secondary */}
            <button style={{
              width: "100%", padding: "15px 0",
              background: "transparent", border: `1.5px solid ${C.zinc200}`,
              borderRadius: 14, cursor: "pointer",
              fontSize: 15, fontFamily: FONT, fontWeight: 500,
              color: C.zinc600, letterSpacing: "0.01em",
            }}>
              나가기
            </button>

            {/* 다시 읽기 — tertiary */}
            <button style={{
              width: "100%", padding: "12px 0",
              background: "transparent", border: "none",
              cursor: "pointer",
              fontSize: 14, fontFamily: FONT, fontWeight: 400,
              color: C.zinc400, letterSpacing: "0.01em",
              textDecoration: "underline", textUnderlineOffset: 3,
            }}>
              다시 읽기
            </button>
          </div>

          {/* home indicator */}
          <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 134, height: 5, borderRadius: 3, background: C.zinc200 }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────── */
export default function ReadingCompletePreview() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#ffffff",
      display: "flex",
      alignItems: "center", justifyContent: "center",
      padding: "48px 40px",
      fontFamily: FONT,
    }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 48 }}>
        <Phone caseType="read" />
        <Phone caseType="answered" />
      </div>
    </div>
  );
}
