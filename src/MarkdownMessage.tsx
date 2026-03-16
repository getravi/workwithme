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
  isStreaming?: boolean;
}

export function MarkdownMessage({ content, isStreaming }: MarkdownMessageProps) {
  return (
    <div className="text-[13px] leading-6 text-[#e5e7eb]">
      <ReactMarkdown
        components={{
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = Boolean(match) || (className === undefined && String(children).includes('\n'));
            if (isBlock) {
              return (
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match ? match[1] : "text"}
                  PreTag="div"
                  customStyle={{
                    margin: "0.5rem 0",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            return (
              <code className="bg-[#111827] px-1 py-0.5 rounded text-[#c5f016] text-[12px] font-mono">
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Prevent double-wrapping — SyntaxHighlighter renders its own pre
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
            return <p className="my-1.5">{children}</p>;
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
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-2 h-3.5 ml-1 bg-[#c5f016] animate-pulse rounded-sm align-middle" />
      )}
    </div>
  );
}
