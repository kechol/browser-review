// SPDX-License-Identifier: Apache-2.0

/** All overlay styling lives in the shadow root so the reviewed page is untouched. */
export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }

.toolbar {
  position: fixed; right: 16px; bottom: 16px; z-index: 10;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 999px;
  background: #16181d; color: #f3f4f6;
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.28);
  font-size: 13px; line-height: 1;
}
.toolbar button {
  all: unset; cursor: pointer; padding: 7px 12px; border-radius: 999px;
  font-size: 13px; font-weight: 500; color: #f3f4f6; white-space: nowrap;
}
.toolbar button:hover { background: #2a2e37; }
.toolbar button[data-on="true"] { background: #3b82f6; color: #fff; }
.toolbar .count { font-variant-numeric: tabular-nums; opacity: 0.75; padding: 0 2px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
.dot[data-state="open"] { background: #22c55e; }
.dot[data-state="closed"] { background: #ef4444; }

.highlight {
  position: absolute; z-index: 5; pointer-events: none;
  border: 2px solid #3b82f6; border-radius: 3px;
  background: rgb(59 130 246 / 0.10);
}
.marquee {
  position: absolute; z-index: 6; pointer-events: none;
  border: 1px dashed #3b82f6; background: rgb(59 130 246 / 0.08);
}
.label {
  position: absolute; z-index: 7; pointer-events: none;
  transform: translateY(-100%);
  background: #3b82f6; color: #fff; font-size: 11px; line-height: 1.4;
  padding: 2px 6px; border-radius: 3px 3px 3px 0; white-space: nowrap;
  max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
}

.pin {
  position: absolute; z-index: 8; cursor: pointer;
  width: 22px; height: 22px; border-radius: 50% 50% 50% 2px;
  display: grid; place-items: center;
  font-size: 11px; font-weight: 700; color: #fff;
  border: 2px solid #fff; box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
  background: #f59e0b;
}
.pin[data-status="acknowledged"] { background: #3b82f6; }
.pin[data-status="resolved"] { background: #22c55e; }
.pin[data-status="dismissed"] { background: #9ca3af; }
.pin[data-asking="true"]::after {
  content: "?"; position: absolute; top: -8px; right: -8px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #ef4444; color: #fff; font-size: 10px; display: grid; place-items: center;
  border: 2px solid #fff;
}

.card, .composer {
  position: absolute; z-index: 9; width: 320px; max-width: calc(100vw - 32px);
  background: #ffffff; color: #111827; border-radius: 10px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22); border: 1px solid #e5e7eb;
  padding: 12px; font-size: 13px; line-height: 1.5;
}
.card h4, .composer h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #6b7280; }
.card .comment { margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; }
.card .meta { color: #6b7280; font-size: 12px; word-break: break-all; }
.card .resolution { margin-top: 8px; padding: 8px; border-radius: 6px; background: #f0fdf4; color: #14532d; }
.card .question { margin-top: 8px; padding: 8px; border-radius: 6px; background: #fef2f2; color: #7f1d1d; }
.card .answer { margin-top: 8px; padding: 8px; border-radius: 6px; background: #f3f4f6; color: #374151; }

textarea {
  width: 100%; min-height: 76px; resize: vertical; padding: 8px;
  border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: inherit;
  color: #111827; background: #fff;
}
textarea:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; align-items: center; }
.row .spacer { margin-right: auto; color: #6b7280; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.primary, button.ghost {
  all: unset; cursor: pointer; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 500;
}
button.primary { background: #3b82f6; color: #fff; }
button.primary:hover { background: #2563eb; }
button.ghost { color: #6b7280; }
button.ghost:hover { background: #f3f4f6; }

.panel {
  position: fixed; right: 16px; bottom: 64px; z-index: 9;
  width: 340px; max-width: calc(100vw - 32px); max-height: 60vh; overflow: auto;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.22); padding: 8px;
}
.panel .item { padding: 8px; border-radius: 6px; cursor: pointer; display: flex; gap: 8px; align-items: flex-start; }
.panel .item:hover { background: #f3f4f6; }
.panel .swatch { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; background: #f59e0b; }
.panel .item[data-status="acknowledged"] .swatch { background: #3b82f6; }
.panel .item[data-status="resolved"] .swatch { background: #22c55e; }
.panel .item[data-status="dismissed"] .swatch { background: #9ca3af; }
.panel .empty { padding: 16px; text-align: center; color: #6b7280; }
.panel .body { min-width: 0; }
.panel .body .text { color: #111827; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.panel .body .where { color: #6b7280; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (prefers-color-scheme: dark) {
  .card, .composer, .panel { background: #1f2329; color: #e5e7eb; border-color: #374151; }
  .card .meta, .panel .body .where, .panel .empty, .row .spacer { color: #9ca3af; }
  .panel .body .text { color: #e5e7eb; }
  .panel .item:hover { background: #2a2e37; }
  textarea { background: #111418; color: #e5e7eb; border-color: #374151; }
  button.ghost:hover { background: #2a2e37; }
  .card .resolution { background: #052e16; color: #bbf7d0; }
  .card .question { background: #3f1212; color: #fecaca; }
  .card .answer { background: #2a2e37; color: #d1d5db; }
}
`;
