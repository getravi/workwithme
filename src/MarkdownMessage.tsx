import { useState, useRef, useEffect, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, ChevronDown, Sparkles } from "lucide-react";

SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);

interface MarkdownMessageProps {
  content: string;
  thinkingContent?: string;
  isStreaming?: boolean;
}

/** Copy button shown on code block hover */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable
    }
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy code"}
      className="absolute top-2 right-2 p-1 rounded bg-[#1f2937] text-gray-400 hover:text-white hover:bg-[#374151] transition-all opacity-0 group-hover:opacity-100"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-[#c5f016]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/** Shared markdown component renderers */
const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || "");
    const isBlock = Boolean(match) || (className === undefined && String(children).includes('\n'));
    if (isBlock) {
      const codeText = String(children).replace(/\n$/, "");
      return (
        <div className="relative group my-2">
          <CopyButton text={codeText} />
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={match ? match[1] : "text"}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: "0.5rem", fontSize: "12px" }}
          >
            {codeText}
          </SyntaxHighlighter>
        </div>
      );
    }
    return (
      <code className="bg-[#111827] px-1 py-0.5 rounded text-[#c5f016] text-[12px] font-mono">
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-[#c5f016]/40 pl-2.5 my-1.5 text-gray-400 italic">
        {children}
      </blockquote>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-[#c5f016] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c5f016]"
      >
        {children}
      </a>
    );
  },
  ul({ children }) {
    return <ul className="list-disc list-inside my-1.5 space-y-0.5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside my-1.5 space-y-0.5">{children}</ol>;
  },
  h1({ children }) {
    return <h1 className="text-lg font-bold mt-3 mb-1.5 text-gray-100">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-base font-semibold mt-2.5 mb-1 text-gray-100">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-200">{children}</h3>;
  },
  p({ children }) {
    return <p className="my-1">{children}</p>;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3 border border-[#374151] rounded-lg">
        <table className="w-full text-left border-collapse text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-[#1f2937] text-xs uppercase tracking-wider">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-3 py-2.5 border-b border-[#374151] text-gray-200 font-semibold">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-2 border-b border-[#374151]/50 text-gray-300 last:border-b-0">{children}</td>;
  },
};

/**
 * Collapsible thinking block.
 * - Expands automatically while streaming.
 * - Collapses to a summary pill once streaming stops.
 * - Click the header to toggle at any time.
 */
function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const wasStreamingRef = useRef(isStreaming);

  useEffect(() => {
    // Collapse once streaming finishes
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  return (
    <div className="mb-3 border border-[#c5f016]/15 rounded-lg bg-[#0f1929] overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
      >
        {isStreaming ? (
          <span className="w-1.5 h-1.5 rounded-full bg-[#c5f016] animate-pulse flex-shrink-0" />
        ) : (
          <Sparkles className="w-3 h-3 text-gray-500 flex-shrink-0" />
        )}
        <span className="flex-1 text-[11px] font-medium tracking-wide text-gray-500 uppercase">
          {isStreaming ? "Reasoning…" : "Reasoning"}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-600 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-[#c5f016]/10">
          <div className="text-[12px] leading-5 text-gray-400">
            <ReactMarkdown components={mdComponents} remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-3 ml-0.5 bg-[#c5f016] animate-pulse rounded-sm align-middle" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const MarkdownMessageInner = function ({ content, thinkingContent, isStreaming }: MarkdownMessageProps) {
  return (
    <div className="text-[13px] leading-6 text-[#e5e7eb]">
      {thinkingContent && (
        <ThinkingBlock content={thinkingContent} isStreaming={isStreaming && !content} />
      )}
      {content && (
        <ReactMarkdown components={mdComponents} remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      )}
      {isStreaming && !content && !thinkingContent && (
        <span className="inline-block w-2 h-3.5 ml-1 bg-[#c5f016] animate-pulse rounded-sm align-middle" />
      )}
      {isStreaming && content && (
        <span className="inline-block w-2 h-3.5 ml-1 bg-[#c5f016] animate-pulse rounded-sm align-middle" />
      )}
    </div>
  );
};

export const MarkdownMessage = memo(MarkdownMessageInner);
