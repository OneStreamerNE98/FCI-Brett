import type { SearchResult } from "../search-records";
import { compact, type AssistantResponse, type Evidence } from "./evidence";

export function searchResultEvidence(result: SearchResult): Evidence {
  return {
    id: `${result.kind}:${result.id}`,
    label: `${result.kind === "project" ? "Project" : result.kind === "client" ? "Client" : "Contact"} · ${result.title}`,
    detail: result.subtitle,
  };
}

export function orgWideFallback(
  question: string,
  results: SearchResult[],
): AssistantResponse {
  return orgWideFallbackFromEvidence(
    question,
    results.slice(0, 5).map(searchResultEvidence),
  );
}

export function orgWideFallbackFromEvidence(
  question: string,
  evidenceInput: Evidence[],
): AssistantResponse {
  const evidence = evidenceInput.slice(0, 5);
  if (evidence.length === 0) {
    return {
      mode: "records-only",
      answer: `The saved records search did not find a direct answer to “${compact(question, 180)}”.`,
      citations: [],
      missingEvidence: "Try a client name, project name or number, or contact. Meeting text, tasks, leads, and filed email metadata require the AI tool loop.",
    };
  }
  return {
    mode: "records-only",
    answer: `The saved records search found ${evidence.length} likely match${evidence.length === 1 ? "" : "es"} for “${compact(question, 180)}”: ${evidence.map((item) => item.label.replace(/^[^·]+· /, "")).join("; ")}.`,
    citations: evidence,
    missingEvidence: "This records-only fallback reports bounded exact record matches; it does not infer an answer or search full email bodies and Drive document contents.",
  };
}
