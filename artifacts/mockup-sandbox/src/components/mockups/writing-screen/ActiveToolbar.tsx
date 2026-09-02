import { useState } from "react";
import "./_group.css";

type IconName = "arrow-left" | "settings" | "plus" | "undo" | "redo" | "scissors" | "corner-down-left" | "keyboard";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "arrow-left":
      return <svg {...common}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20h-2.6v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6v-2.6h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L9 6.6l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V5h2.6v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v2.6h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case "undo":
      return <svg {...common}><path d="M9 7 4 12l5 5" /><path d="M4 12h10a6 6 0 0 1 6 6" /></svg>;
    case "redo":
      return <svg {...common}><path d="m15 7 5 5-5 5" /><path d="M20 12H10a6 6 0 0 0-6 6" /></svg>;
    case "scissors":
      return <svg {...common}><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><path d="m8 7 12 10M8 17 20 7" /></svg>;
    case "corner-down-left":
      return <svg {...common}><path d="M19 7v5a4 4 0 0 1-4 4H5" /><path d="m9 12-4 4 4 4" /></svg>;
    case "keyboard":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M7 13h.01M11 13h.01M15 13h.01M19 13h.01M8 16h8" /></svg>;
  }
}

function ToolButton({
  children,
  active = false,
  muted = false,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  muted?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button className={`tool-button${active ? " is-active" : ""}${muted ? " is-muted" : ""}`} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function ActiveToolbar() {
  const [formatOpen, setFormatOpen] = useState(true);
  const [activeFormat, setActiveFormat] = useState<"bold" | "italic" | "underline" | "quote">("bold");

  return (
    <main className="writing-screen">
      <div className="status-bar">
        <span>19:54</span>
        <span className="status-icons"><span className="silent">⌁</span><span>▮▮</span><span>LTE</span><span className="battery" /></span>
      </div>

      <section className="editor">
        <div className="body-copy">
          <p>누워있는 몸을 멍하니 바라봤어요. 그리고 눈을 뜨고 보아 알았답니다. 구름은 움직이고 있었어요.</p>
          <p>지난 일 년 정도는 잊고 지냈던 것 같네요. 일주일에 한 번은 두 눈으로 보아 아는 시간을 보내며 살았으면 해요. 그 정도의 사치를 누릴 수 있기를 바라요.</p>
          <p>구름이 움직이는 것을 아시나요? 크기에 상관없이 구름은 바람 따라 흐르고 있답니다. 머리로는 많이들 아시겠지만, 두 눈으로 보아 아시는 분이 얼마나 있을까요.</p>
          <p>어제 계곡에 가 큰 돌 위에 누워 하늘을 바라봤어요. 구름은 움직이고 있었어요.</p>
        </div>
      </section>

      <div className="top-fade" aria-hidden="true" />

      <header className="writing-header">
        <button className="round-action back-button" aria-label="기록 목록으로 돌아가기"><Icon name="arrow-left" size={20} /></button>
        <div className="state-bar" role="tablist" aria-label="작성 단계">
          <button className="state-tab selected" role="tab" aria-selected="true">단상</button>
          <button className="state-tab" role="tab" aria-selected="false">검토</button>
          <button className="state-tab disabled" role="tab" aria-selected="false">마감</button>
        </div>
        <button className="round-action settings-button" aria-label="작성 설정"><Icon name="settings" size={22} /></button>
      </header>

      <div className="toolbar-fade" aria-hidden="true" />
      <section className="toolbar-wrap" aria-label="서식 툴바">
        <div className="toolbar-capsule">
          <div className="toolbar-scroll">
            <ToolButton label="본문 형식" active>본문</ToolButton>
            <ToolButton label="서식 메뉴 닫기" active={formatOpen} onClick={() => setFormatOpen((open) => !open)}>Aa</ToolButton>
            {formatOpen && (
              <div className="format-group">
                <ToolButton label="굵게" active={activeFormat === "bold"} onClick={() => setActiveFormat("bold")}><strong>B</strong></ToolButton>
                <ToolButton label="기울임" active={activeFormat === "italic"} onClick={() => setActiveFormat("italic")}><em>I</em></ToolButton>
                <ToolButton label="밑줄" active={activeFormat === "underline"} onClick={() => setActiveFormat("underline")}><u>U</u></ToolButton>
                <ToolButton label="인용" active={activeFormat === "quote"} onClick={() => setActiveFormat("quote")}>“</ToolButton>
              </div>
            )}
            <ToolButton label="추가"><Icon name="plus" /></ToolButton>
            <ToolButton label="실행 취소"><Icon name="undo" /></ToolButton>
            <ToolButton label="다시 실행" muted><Icon name="redo" /></ToolButton>
            <ToolButton label="구분선"><Icon name="scissors" size={16} /></ToolButton>
            <ToolButton label="줄바꿈"><Icon name="corner-down-left" size={16} /></ToolButton>
          </div>
          <div className="toolbar-divider" />
          <ToolButton label="키보드 닫기"><Icon name="keyboard" size={20} /></ToolButton>
        </div>
      </section>
    </main>
  );
}