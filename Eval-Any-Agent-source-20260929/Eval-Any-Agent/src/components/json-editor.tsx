"use client";

import CodeMirror from "@uiw/react-codemirror";
import type { CSSProperties } from "react";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cn } from "@/lib/utils";

type JsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  height?: string;
  className?: string;
  readOnly?: boolean;
  ariaLabel?: string;
};

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--json-editor-property)" },
  { tag: tags.string, color: "var(--json-editor-string)" },
  { tag: tags.number, color: "var(--json-editor-number)" },
  { tag: [tags.bool, tags.null], color: "var(--json-editor-literal)" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "var(--json-editor-punctuation)" },
  { tag: tags.invalid, color: "var(--destructive)" },
]);

const jsonEditorTheme = EditorView.theme({
  "&": {
    minHeight: "var(--json-editor-min-height)",
    color: "var(--foreground)",
    backgroundColor: "transparent",
    fontSize: "0.75rem",
    lineHeight: "1.5rem",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    minHeight: "var(--json-editor-min-height)",
    overflow: "auto",
    fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  ".cm-content": {
    minHeight: "var(--json-editor-min-height)",
    padding: "0.5rem 0",
    caretColor: "var(--foreground)",
  },
  ".cm-line": {
    padding: "0 0.75rem",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--border)",
    backgroundColor: "color-mix(in oklch, var(--muted) 42%, transparent)",
    color: "var(--muted-foreground)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2.5rem",
    padding: "0 0.5rem 0 0.75rem",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "&.cm-focused .cm-activeLine, &.cm-focused .cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--muted) 62%, transparent)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklch, var(--ring) 32%, transparent)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--ring) 28%, transparent)",
    outline: "1px solid var(--ring)",
  },
  ".cm-diagnostic": {
    textDecorationColor: "var(--destructive)",
  },
});

const jsonEditorExtensions = [
  json(),
  EditorView.lineWrapping,
  jsonEditorTheme,
  syntaxHighlighting(jsonHighlightStyle),
];

export function JsonEditor({ value, onChange, rows = 10, height, className, readOnly, ariaLabel }: JsonEditorProps) {
  const minHeight = `${rows * 24 + 16}px`;

  return (
    <CodeMirror
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      height={height}
      readOnly={readOnly}
      editable={!readOnly}
      theme="none"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        bracketMatching: false,
        highlightSelectionMatches: false,
        autocompletion: false,
        searchKeymap: true,
        foldKeymap: false,
        completionKeymap: false,
        lintKeymap: false,
        tabSize: 2,
      }}
      extensions={jsonEditorExtensions}
      className={cn(
        "overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
      style={{ "--json-editor-min-height": minHeight } as CSSProperties}
    />
  );
}
