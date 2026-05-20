import { useEffect, useRef } from "react";
import { Bot } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage";
import { StatusIndicator } from "./StatusIndicator";
import { useChat } from "./context/ChatContext";
import { useUI } from "./context/UIContext";

export function ChatArea() {
  const {
    messages, isProcessing, currentToolStatus,
    chatError, setChatError,
  } = useChat();
  const { setActiveView, setSettingsTab, sandboxStatus, sandboxBannerDismissed } = useUI();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when message count changes (not on every streaming delta)
  const messageCount = messages.length;
  useEffect(() => {
    if (chatEndRef.current && typeof chatEndRef.current.scrollIntoView === "function") {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messageCount]);

  const hasBanner = sandboxStatus && !sandboxStatus.active && !sandboxBannerDismissed;

  return (
    <div
      className={`flex-1 overflow-y-auto px-3 scroll-smooth ${hasBanner ? "pt-28" : "pt-16"} pb-4`}
    >
      {isProcessing && !messages.some((m) => m.role === "assistant" && m.isStreaming && m.content.trim() !== "") && (
        <StatusIndicator status={currentToolStatus ?? undefined} isStreaming={isProcessing} />
      )}

      {chatError && (
        <div className="max-w-4xl mx-auto mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-[13px] flex items-center justify-between gap-3">
          <span>{chatError}</span>
          {/Connections to reconnect/.test(chatError) && (
            <button
              onClick={() => {
                setActiveView("settings");
                setSettingsTab("connections");
                setChatError(null);
              }}
              className="shrink-0 text-[#c5f016] underline hover:no-underline text-[12px]"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3 max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#182234] border border-[#1f2937] flex items-center justify-center shadow-lg">
            <Bot className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-200">Hello, I'm your productivity agent.</h2>
          <p className="text-[13px] text-gray-400">
            Attach files, ask me to write code, or open the preview pane to see artifacts render in real-time.
          </p>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "assistant" ? "fade-in" : "flex-row-reverse"}`}
            >
              <div className="flex-shrink-0 mt-1">
                {msg.role === "assistant" ? (
                  <div className="w-7 h-7 rounded-lg bg-[#182234] border border-[#1f2937] flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-gray-400" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-[#fde047] flex items-center justify-center flex-shrink-0 text-[#111827] text-[12px] font-bold shadow-md">
                    U
                  </div>
                )}
              </div>
              <div className={`flex-1 text-[13px] leading-6 relative ${msg.role === "user" ? "max-w-[78%]" : ""}`}>
                {msg.role === "assistant" ? (
                  <MarkdownMessage
                    content={msg.content}
                    thinkingContent={msg.thinkingContent}
                    isStreaming={msg.isStreaming}
                  />
                ) : (
                  <div className="bg-[#1f2937] px-4 py-2.5 rounded-xl rounded-tr-sm text-[#f3f4f6] whitespace-pre-wrap inline-block shadow-sm w-full text-right">
                    {msg.content}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={chatEndRef} className="h-3" />
        </div>
      )}
    </div>
  );
}
