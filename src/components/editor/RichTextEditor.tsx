"use client";

// Rich-text editor for Article Studio, built on Tiptap's free, open-source
// core and free extensions only (no Pro features, no paid cloud service).
//
// - Content model: HTML persisted on ArticleDraft.body (WordPress-compatible).
// - Pasted content is sanitized with DOMPurify (mirrors the server allowlist).
// - AI actions ("improve" / "regenerate") act on the selected range ONLY and
//   never replace the whole article.
// - Keyboard accessible: every toolbar control is a real button with an
//   aria-label; Tiptap's built-in shortcuts (Ctrl/Cmd+B/I/U/Z/Y, etc.) apply.

import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { sanitizeHtmlClient } from "@/lib/markup-client";

export type AiEditMode = "improve" | "regenerate";
export type AiEditRequest = { mode: AiEditMode; selection: string };
export type AiEditResponse = { text?: string; error?: string };

export interface RichTextEditorProps {
  initialContent: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (html: string) => void;
  onAiEdit?: (req: AiEditRequest) => Promise<AiEditResponse>;
}

function ToolbarButton({
  label,
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

const DIVIDER = <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />;

export function RichTextEditor({ initialContent, placeholder = "Start writing…", disabled, onChange, onAiEdit }: RichTextEditorProps) {
  const [stats, setStats] = useState<{ words: number; chars: number }>({ words: 0, chars: 0 });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      Image.configure({ inline: false, allowBase64: false }),
      Underline,
      Placeholder.configure({ placeholder }),
      CharacterCount,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent || "",
    editable: !disabled,
    editorProps: {
      attributes: { class: "rich-text-prose focus:outline-none", "aria-label": "Article content editor" },
      transformPastedHTML(html: string) {
        return sanitizeHtmlClient(html);
      },
    },
    onUpdate: ({ editor: e }) => {
      setStats({ words: e.storage.characterCount.words(), chars: e.storage.characterCount.characters() });
      onChange?.(e.getHTML());
    },
  });

  // Sync externally-provided content (switching drafts, loading revisions).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (initialContent && initialContent !== current) {
      editor.commands.setContent(initialContent, false);
      setStats({ words: editor.storage.characterCount.words(), chars: editor.storage.characterCount.characters() });
    } else if (!initialContent && current !== "<p></p>") {
      editor.commands.setContent("", false);
      setStats({ words: 0, chars: 0 });
    }
  }, [initialContent, editor]);

  const toggleBold = () => editor?.chain().focus().toggleBold().run();
  const toggleItalic = () => editor?.chain().focus().toggleItalic().run();
  const toggleUnderline = () => editor?.chain().focus().toggleUnderline().run();
  const toggleStrike = () => editor?.chain().focus().toggleStrike().run();
  const toggleCode = () => editor?.chain().focus().toggleCode().run();
  const toggleCodeBlock = () => editor?.chain().focus().toggleCodeBlock().run();
  const toggleBullet = () => editor?.chain().focus().toggleBulletList().run();
  const toggleOrdered = () => editor?.chain().focus().toggleOrderedList().run();
  const toggleQuote = () => editor?.chain().focus().toggleBlockquote().run();
  const setHeading = (level: 1 | 2 | 3) => editor?.chain().focus().toggleHeading({ level }).run();
  const undo = () => editor?.chain().focus().undo().run();
  const redo = () => editor?.chain().focus().redo().run();
  const clearFormat = () => editor?.chain().focus().unsetAllMarks().clearNodes().run();

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (https://…)", previous ?? "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (trimmed === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:|[/#])/i.test(trimmed)) {
      setAiNotice("Enter an absolute URL (https://…) or a relative path.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
    setAiNotice(null);
  };
  const unsetLink = () => editor?.chain().focus().extendMarkRange("link").unsetLink().run();

  const addImage = () => {
    if (!editor) return;
    const src = window.prompt("Image URL (https://…)");
    if (!src || !src.trim()) return;
    const alt = window.prompt("Alt text (accessibility)") ?? "";
    editor.chain().focus().setImage({ src: src.trim(), alt: alt.trim() }).run();
  };

  const insertTable = () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  const addRow = () => editor?.chain().focus().addRowAfter().run();
  const deleteRow = () => editor?.chain().focus().deleteRow().run();
  const addCol = () => editor?.chain().focus().addColumnAfter().run();
  const deleteCol = () => editor?.chain().focus().deleteColumn().run();
  const deleteTable = () => editor?.chain().focus().deleteTable().run();

  async function runAi(mode: AiEditMode) {
    if (!editor || !onAiEdit) return;
    const { from, to } = editor.state.selection;
    const selection = editor.state.doc.textBetween(from, to, " ").trim();
    if (!selection) {
      setAiNotice("Select the text you want to change first.");
      return;
    }
    setAiBusy(true);
    setAiNotice(null);
    try {
      const res = await onAiEdit({ mode, selection });
      if (res.error || !res.text) {
        setAiNotice(res.error ?? "AI returned nothing — selection unchanged.");
        return;
      }
      editor.chain().focus().insertContentAt({ from, to }, res.text).run();
      setAiNotice(mode === "improve" ? "Selection improved." : "Section regenerated.");
    } catch {
      setAiNotice("AI action failed — your text was not changed.");
    } finally {
      setAiBusy(false);
    }
  }

  const isActive = useMemo(
    () => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      strike: editor?.isActive("strike") ?? false,
      code: editor?.isActive("code") ?? false,
      codeBlock: editor?.isActive("codeBlock") ?? false,
      bullet: editor?.isActive("bulletList") ?? false,
      ordered: editor?.isActive("orderedList") ?? false,
      quote: editor?.isActive("blockquote") ?? false,
      link: editor?.isActive("link") ?? false,
      table: editor?.isActive("table") ?? false,
      h1: editor?.isActive("heading", { level: 1 }) ?? false,
      h2: editor?.isActive("heading", { level: 2 }) ?? false,
      h3: editor?.isActive("heading", { level: 3 }) ?? false,
    }),
    [editor]
  );

  if (!editor) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Loading editor…</div>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200" data-testid="rich-text-editor">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5" role="toolbar" aria-label="Formatting toolbar">
        <ToolbarButton label="Paragraph (P)" onClick={() => editor?.chain().focus().setParagraph().run()} active={!isActive.h1 && !isActive.h2 && !isActive.h3 && !isActive.quote && !isActive.codeBlock && !isActive.table}>
          ¶
        </ToolbarButton>
        <ToolbarButton label="Heading 1" onClick={() => setHeading(1)} active={isActive.h1} title="Heading 1">
          H1
        </ToolbarButton>
        <ToolbarButton label="Heading 2" onClick={() => setHeading(2)} active={isActive.h2} title="Heading 2">
          H2
        </ToolbarButton>
        <ToolbarButton label="Heading 3" onClick={() => setHeading(3)} active={isActive.h3} title="Heading 3">
          H3
        </ToolbarButton>
        {DIVIDER}
        <ToolbarButton label="Bold (Ctrl+B)" onClick={toggleBold} active={isActive.bold}>
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton label="Italic (Ctrl+I)" onClick={toggleItalic} active={isActive.italic}>
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton label="Underline (Ctrl+U)" onClick={toggleUnderline} active={isActive.underline}>
          <u>U</u>
        </ToolbarButton>
        <ToolbarButton label="Strikethrough" onClick={toggleStrike} active={isActive.strike}>
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton label="Inline code" onClick={toggleCode} active={isActive.code}>
          {"</>"}
        </ToolbarButton>
        {DIVIDER}
        <ToolbarButton label="Bulleted list" onClick={toggleBullet} active={isActive.bullet}>
          •≡
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={toggleOrdered} active={isActive.ordered}>
          1≡
        </ToolbarButton>
        <ToolbarButton label="Blockquote" onClick={toggleQuote} active={isActive.quote}>
          ❝
        </ToolbarButton>
        <ToolbarButton label="Code block" onClick={toggleCodeBlock} active={isActive.codeBlock}>
          {"{ }"}
        </ToolbarButton>
        {DIVIDER}
        <ToolbarButton label="Add link" onClick={setLink} active={isActive.link}>
          🔗
        </ToolbarButton>
        <ToolbarButton label="Remove link" onClick={unsetLink} disabled={!isActive.link}>
          🔗✕
        </ToolbarButton>
        <ToolbarButton label="Insert image (URL + alt text)" onClick={addImage}>
          🖼
        </ToolbarButton>
        <ToolbarButton label="Insert table" onClick={insertTable} active={isActive.table}>
          ▦
        </ToolbarButton>
        <ToolbarButton label="Add table row below" onClick={addRow} disabled={!isActive.table}>
          ⬍
        </ToolbarButton>
        <ToolbarButton label="Delete table row" onClick={deleteRow} disabled={!isActive.table}>
          ⬆
        </ToolbarButton>
        <ToolbarButton label="Add table column after" onClick={addCol} disabled={!isActive.table}>
          ⬌
        </ToolbarButton>
        <ToolbarButton label="Delete table column" onClick={deleteCol} disabled={!isActive.table}>
          ⬭
        </ToolbarButton>
        <ToolbarButton label="Delete table" onClick={deleteTable} disabled={!isActive.table}>
          ▦✕
        </ToolbarButton>
        {DIVIDER}
        <ToolbarButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!editor.can().chain().undo().run()}>
          ↩
        </ToolbarButton>
        <ToolbarButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!editor.can().chain().redo().run()}>
          ↪
        </ToolbarButton>
        <ToolbarButton label="Clear formatting" onClick={clearFormat}>
          ⌫
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} className="editor-content" />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span aria-live="polite">{aiNotice ?? "Pasted content is sanitized automatically."}</span>
          {onAiEdit && (
            <>
              <button
                type="button"
                disabled={aiBusy}
                onClick={() => runAi("improve")}
                className="rounded px-2 py-0.5 text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                ✨ Improve selection
              </button>
              <button
                type="button"
                disabled={aiBusy}
                onClick={() => runAi("regenerate")}
                className="rounded px-2 py-0.5 text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                ♻ Regenerate selection
              </button>
            </>
          )}
        </span>
        <span data-testid="editor-stats" aria-label={`${stats.words} words, ${stats.chars} characters`}>
          {stats.words} words · {stats.chars} chars
        </span>
      </div>
    </div>
  );
}