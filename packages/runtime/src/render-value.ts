import { escapeHtml } from "./escape-html";

export function renderValue(value: unknown): string {
  return escapeHtml(value);
}

export function renderAttributeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return escapeHtml(String(value));
}
