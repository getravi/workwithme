import { useState, useEffect, useCallback } from "react";
import {
  Send, Paperclip, FolderOpen, Mic, MicOff, CircleStop, Zap, Loader2, X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useChat } from "./context/ChatContext";
import { useUI } from "./context/UIContext";
import { useWebSocket } from "./context/WebSocketContext";
import { useFileAttachments } from "./hooks/useFileAttachments";
import { useProjectPicker } from "./hooks/useProjectPicker";
import { ModelSelector } from "./ModelSelector";

export function MessageInput() {
  const { handleSubmit, handleStop, isProcessing, isSteering } = useChat();
  const { selectedModel, availableModels, handleModelChange, setIsRecording, isRecording } = useUI();
  const { isConnected } = useWebSocket();
  const { attachments, handleAttachFile, handleTextareaPaste, removeAttachment, clearAttachments } =
    useFileAttachments();
  const { openProjectPicker } = useProjectPicker();
  const [input, setInput] = useState("");

  // Listen for dictation results from Rust backend
  useEffect(() => {
    const unlisten = listen<string>("dictation-result", (event) => {
      setInput((prev) => (prev ? prev + " " + event.payload : event.payload));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const handleVoiceInput = useCallback(async () => {
    try {
      await invoke("toggle_in_app_dictation");
      setIsRecording((prev) => !prev);
    } catch (e) {
      console.error("[MessageInput] voice toggle failed", e);
    }
  }, [setIsRecording]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if ((!input.trim() && attachments.length === 0) || !isConnected) return;
      handleSubmit(input, attachments);
      setInput("");
      clearAttachments();
    },
    [input, attachments, isConnected, handleSubmit, clearAttachments],
  );

  const submitDisabled = (!input.trim() && attachments.length === 0) || !isConnected;

  return (
    <div className="p-3 mx-auto w-full max-w-4xl relative z-20 bg-gradient-to-t from-[#111827] via-[#111827] to-transparent pt-6">
      <form
        onSubmit={onSubmit}
        className="relative flex flex-col bg-[#182234] rounded-xl border border-[#374151] shadow-xl focus-within:border-[#c5f016]/50 transition-all duration-200"
      >
        <div className="px-3 pt-3 pb-1.5">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 bg-[#1f2937] px-2 py-1 rounded-lg border border-[#374151]"
                >
                  <Paperclip className="w-3 h-3 text-gray-400" />
                  <span className="text-[12px] text-gray-300 max-w-[150px] truncate">{att.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="p-0.5 hover:bg-[#4b5563] rounded-full text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="w-full max-h-44 min-h-[38px] bg-transparent resize-none text-[#f3f4f6] placeholder-gray-500 focus:outline-none text-[13px]"
            placeholder={isProcessing ? "Steer the agent... (sends a mid-task correction)" : "Message Agent..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e); }
            }}
            onPaste={handleTextareaPaste}
            rows={Math.min(Math.max(input.split("\n").length, 1), 8)}
          />
        </div>

        <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1">
            <button type="button" onClick={handleAttachFile} className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-[#374151] transition-colors" title="Attach Files">
              <Paperclip className="w-4 h-4" />
            </button>
            <button type="button" onClick={openProjectPicker} className="p-1.5 text-gray-400 hover:text-[#c5f016] rounded-lg hover:bg-[#374151] transition-colors" title="Select Project Folder">
              <FolderOpen className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleVoiceInput}
              className={`p-1.5 rounded-lg hover:bg-[#374151] transition-colors ${isRecording ? "text-red-400 animate-pulse" : "text-gray-400 hover:text-white"}`}
              title={isRecording ? "Stop recording" : "Voice input"}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ModelSelector
              selected={selectedModel}
              models={availableModels}
              onChange={handleModelChange}
            />

            {isProcessing && (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop"
                className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 transition-all shadow-sm flex items-center gap-2 px-3 text-[13px] font-medium"
              >
                <CircleStop className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Stop</span>
              </button>
            )}

            <button
              type="submit"
              aria-label={isProcessing ? (isSteering ? "Steering..." : "Steer") : "Send"}
              disabled={submitDisabled}
              className={`p-1.5 rounded-lg transition-all shadow-sm flex items-center gap-2 px-3 text-[13px] font-medium ${
                isProcessing ? "bg-[#374151] text-gray-300 hover:bg-[#4b5563]" : "bg-[#c5f016] text-[#111827] hover:bg-[#d6f733]"
              }`}
            >
              {isProcessing ? (
                isSteering ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#c5f016]" /> : <Zap className="w-3.5 h-3.5 text-[#c5f016]" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>{isProcessing ? (isSteering ? "Steering..." : "Steer") : "Send"}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
