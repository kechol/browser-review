// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import type { Annotation, AnnotationStatus, Session, SessionFile } from "@browser-review/shared";
import { UNTRUSTED_INPUT_NOTICE } from "@browser-review/shared";
import { summarizeHint } from "./annotations.js";
import { resolveScopedPath } from "./path-util.js";

/** Render a comment so that it can never be mistaken for part of the prompt. */
export function quoteComment(comment: string): string {
  const body = comment.trim() === "" ? "(empty)" : comment.trim();
  return body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function reviewUrl(session: Session): string {
  const entry = (session.entryPath ?? "").replace(/^\/+/, "");
  return `http://127.0.0.1:${session.port}/r/${session.token}/${entry}`;
}

/**
 * Control endpoints live under `__br/` so that, in proxy mode, they cannot
 * shadow a route of the application being reviewed.
 */
export function controlUrl(session: Session, route: string): string {
  return `http://127.0.0.1:${session.port}/r/${session.token}/__br/${route}`;
}

export function mcpUrl(session: Session): string {
  return controlUrl(session, "mcp");
}

export function feedUrl(session: Session): string {
  return controlUrl(session, "feed");
}

/** Where the agent is allowed to edit in this session. */
export function editableScope(session: Session): string {
  return session.mode === "html-file"
    ? `the single file ${session.target}`
    : `files under ${session.projectDir}`;
}

export function isInScope(session: Session, file: string): boolean {
  if (/^[A-Za-z]:[^\\/]/.test(file)) return false;
  const resolved = path.isAbsolute(file)
    ? path.resolve(file)
    : path.resolve(session.projectDir, file);
  if (session.mode === "html-file") return resolved === path.resolve(session.target);
  return resolveScopedPath(session.projectDir, file) !== null;
}

/** Heads one session's part of a listing that spans several sessions. */
export function sessionHeading(session: Session): string {
  return `# Session ${session.id} — ${session.target}`;
}

/** One line per annotation, for `review_list` and the hook. */
export function formatBrief(annotation: Annotation): string {
  const top = annotation.sourceHints[0];
  const where = top ? summarizeHint(top) : annotation.element.tag || "unknown element";
  const comment = annotation.comment.replace(/\s+/g, " ").trim();
  return `- ${annotation.id} [${annotation.status}] ${where}\n  “${comment}”`;
}

/** Everything known about one annotation, for `review_get` and `review_wait`. */
export function formatDetail(annotation: Annotation): string {
  const lines: string[] = [];
  lines.push(`## ${annotation.id}  (${annotation.status})`);
  lines.push("");
  lines.push("Reviewer comment:");
  lines.push(quoteComment(annotation.comment));
  lines.push("");
  lines.push(`Page: ${annotation.page.title || "(untitled)"} — ${annotation.page.url}`);
  lines.push(`Element: <${annotation.element.tag}>`);
  lines.push("```html");
  lines.push(annotation.element.outerHtmlHead);
  lines.push("```");
  lines.push("");
  if (annotation.sourceHints.length === 0) {
    lines.push("Source hints: none. Ask the reviewer with review_ask.");
  } else {
    lines.push("Source hints, most reliable first:");
    for (const hint of annotation.sourceHints) {
      lines.push(`  ${hint.confidence.toFixed(2)}  ${hint.kind}: ${summarizeHint(hint)}`);
    }
  }
  if (annotation.questions.length > 0) {
    lines.push("");
    lines.push("Conversation:");
    for (const q of annotation.questions) {
      lines.push(`  ${q.from === "agent" ? "you" : "reviewer"}: ${q.text.replace(/\s+/g, " ")}`);
    }
  }
  if (annotation.resolution) {
    lines.push("");
    lines.push(
      `Resolved at ${annotation.resolution.at}: ${annotation.resolution.summary} ` +
        `(${annotation.resolution.filesChanged.join(", ") || "no files listed"})`,
    );
  }
  return lines.join("\n");
}

/**
 * The block that carries annotation text into a model's context. Scopes are
 * stated per session and never merged: an annotation may only be fixed inside
 * the scope of the session it belongs to.
 */
export function formatDelivery(groups: SessionFile[]): string {
  const total = groups.reduce((sum, group) => sum + group.annotations.length, 0);
  const single = groups.length === 1 ? groups[0] : undefined;
  const header = [
    UNTRUSTED_INPUT_NOTICE,
    "",
    single
      ? `Editing scope for this session: ${editableScope(single.session)}. Do not change anything else.`
      : "These annotations come from several review sessions. Fix each one only inside the " +
        "editing scope of the session it is listed under.",
    "",
    `${total} annotation${total === 1 ? "" : "s"} to work through:`,
    "",
  ];
  const body = groups.map((group) => {
    const details = group.annotations.map(formatDetail).join("\n\n---\n\n");
    if (single) return details;
    return [
      sessionHeading(group.session),
      `Editing scope: ${editableScope(group.session)}.`,
      "",
      details,
    ].join("\n");
  });
  return [...header, body.join("\n\n---\n\n")].join("\n");
}

export function countByStatus(annotations: Annotation[]): Record<AnnotationStatus, number> {
  const counts = { pending: 0, acknowledged: 0, resolved: 0, dismissed: 0 };
  for (const annotation of annotations) {
    if (annotation.status in counts) counts[annotation.status] += 1;
  }
  return counts;
}

export function formatStatus(file: SessionFile): string {
  const { session, annotations } = file;
  const counts = countByStatus(annotations);
  return [
    `Session ${session.id} (${session.mode})`,
    `  target:     ${session.target}`,
    `  project:    ${session.projectDir}`,
    `  review URL: ${reviewUrl(session)}`,
    `  handoff:    ${mcpUrl(session)}`,
    `  annotations: pending ${counts.pending}, acknowledged ${counts.acknowledged}, resolved ${
      counts.resolved
    }, dismissed ${counts.dismissed}`,
    "",
    `Editing scope: ${editableScope(session)}.`,
  ].join("\n");
}
