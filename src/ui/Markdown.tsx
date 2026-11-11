import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, FilePlus2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { useTabs } from "@/stores/tabs";

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { t: tr } = useI18n();
  const [copied, setCopied] = useState(false);
  const requestInsert = useTabs((s) => s.requestInsert);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-canvas">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="font-mono text-[11px] text-ink-500">{lang || "code"}</span>
        <div className="flex items-center gap-0.5">
          <button
            title={tr("chat.insertTitle")}
            aria-label={tr("chat.insertTitle")}
            onClick={() => { if (useTabs.getState().activeId) requestInsert(code); }}
            className="aide-icon-button size-6"
          >
            <FilePlus2 size={13} />
          </button>
          <button
            title={tr("chat.copyTitle")}
            aria-label={tr("chat.copyTitle")}
            onClick={copy}
            className="aide-icon-button size-6"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </div>
      <pre className="aide-scroll aide-scroll-x overflow-x-auto px-3 pb-3 pt-1 font-mono text-[12px] leading-5 text-ink-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Model output as Markdown: headings, lists, tables, quotes, links and code blocks. Raw HTML is NOT rendered
 * (react-markdown escapes it), links open in the system browser with noopener.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-ink-500">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-ink-500">{children}</ol>,
        h1: ({ children }) => <h1 className="mb-2 mt-4 text-[16px] font-semibold text-ink-50">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-4 text-[15px] font-semibold text-ink-50">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-[14px] font-semibold text-ink-50">{children}</h3>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-ink-50 underline decoration-ink-600 underline-offset-2 hover:decoration-ink-300">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-ink-300">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="aide-scroll aide-scroll-x my-2 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border-b border-line-strong px-2 py-1 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border-b border-line px-2 py-1">{children}</td>,
        code({ className, children }) {
          const inline = !className && !String(children).includes("\n");
          const text = String(children).replace(/\n$/, "");
          if (inline) {
            return (
              <code className="rounded-md bg-white/[0.08] px-1.5 py-px font-mono text-[12px] text-ink-50">
                {text}
              </code>
            );
          }
          const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
          return <CodeBlock code={text} lang={lang} />;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});
