import {
  compact,
  matchingEvidence,
  parseStringArray,
  type AssistantResponse,
  type ContactRecord,
  type Evidence,
  type EvidenceTotals,
  type MeetingRecord,
  type ProjectRecord,
} from "./evidence";

export function fallbackAnswer(
  question: string,
  project: ProjectRecord,
  evidence: Evidence[],
  totals: EvidenceTotals,
  primaryContact: ContactRecord | null,
  meetings: MeetingRecord[],
): AssistantResponse {
  const normalizedQuestion = question.toLowerCase();
  const projectCitation = `project:${project.id}`;
  const summaryCitation = `summary:${project.id}`;
  const base = { mode: "records-only" as const };

  if (/\b(status|stage|current state|project state|where (?:is|are))\b/.test(normalizedQuestion)) {
    return {
      ...base,
      answer: `${project.project_number} — ${project.name} is currently ${project.status}.${project.site ? ` The recorded site is ${project.site}.` : " No site is recorded."}${project.project_manager ? ` The project manager is ${project.project_manager}.` : " No project manager is recorded."}`,
      citations: matchingEvidence(evidence, [projectCitation]),
      missingEvidence: "Phase history, dated shifts, and completion progress are not available in the current project record.",
    };
  }

  if (/\b(primary contact|contact person|client contact|who (?:is|should|do)|email address|phone number)\b/.test(normalizedQuestion)) {
    if (!primaryContact) {
      const hasContacts = totals.contacts > 0;
      return {
        ...base,
        answer: hasContacts
          ? `${totals.contacts} client contact${totals.contacts === 1 ? " is" : "s are"} saved for ${project.client_name}, but none is marked as the primary contact.`
          : `No client contact is saved for ${project.client_name}.`,
        citations: matchingEvidence(evidence, [summaryCitation, projectCitation]),
        missingEvidence: hasContacts
          ? "Mark one saved client contact as primary before relying on a primary-contact answer."
          : "A primary contact name, email address, and phone number need to be added to the client record.",
      };
    }
    return {
      ...base,
      answer: `The primary client contact is ${primaryContact.name}${primaryContact.role ? ` (${primaryContact.role})` : ""}${primaryContact.email ? ` at ${primaryContact.email}` : ""}.`,
      citations: matchingEvidence(evidence, [`contact:${primaryContact.id}`]),
      missingEvidence: primaryContact.email ? "A phone number is not included in the assistant evidence." : "The primary contact does not have an email address in the saved record.",
    };
  }

  if (/\b(email|emails|archive|correspondence|attachment)\b/.test(normalizedQuestion)) {
    const archiveIds = evidence.filter((item) => item.id.startsWith("email:")).map((item) => item.id);
    return {
      ...base,
      answer: `${totals.archives} review-approved email archive${totals.archives === 1 ? " is" : "s are"} filed to this project in the active Google Workspace connection.`,
      citations: matchingEvidence(evidence, [summaryCitation, ...archiveIds]),
      missingEvidence: totals.archives > 0 ? "The archive metadata and attachment counts are available, but full email bodies are not indexed yet." : "No review-approved filed email is available for this project in the active Google Workspace connection.",
    };
  }

  if (/\b(meeting|otter|decision|decided|action item|transcript|meeting notes?)\b/.test(normalizedQuestion)) {
    if (meetings.length === 0) {
      return {
        ...base,
        answer: `No meeting record is saved for ${project.project_number}.`,
        citations: matchingEvidence(evidence, [summaryCitation, projectCitation]),
        missingEvidence: "Add reviewed meeting notes, an Otter link, a summary, decisions, action items, or a transcript before asking meeting-specific questions.",
      };
    }
    const latest = meetings[0];
    const actions = parseStringArray(latest.action_items_json, 8);
    const facts = [
      `The latest saved meeting is “${compact(latest.title, 160)}” from ${new Date(latest.meeting_at).toLocaleString()}.`,
      latest.summary ? `Summary: ${compact(latest.summary, 500)}.` : "",
      latest.decisions ? `Decisions: ${compact(latest.decisions, 400)}.` : "",
      actions.length > 0 ? `Action items: ${actions.map((item) => compact(item, 140)).join("; ")}.` : "",
    ].filter(Boolean);
    return {
      ...base,
      answer: facts.join(" "),
      citations: matchingEvidence(evidence, [`meeting:${latest.id}`, summaryCitation]),
      missingEvidence: `${totals.meetings} meeting record${totals.meetings === 1 ? " is" : "s are"} saved. This records-only answer summarizes the latest meeting; raw Drive files and older records outside the bounded evidence set are not searched.`,
    };
  }

  if (/\b(missing|evidence|available|not found|do(?:es)? not know|don't know|unknown)\b/.test(normalizedQuestion)) {
    return {
      ...base,
      answer: `Available evidence for ${project.project_number} includes the project record, ${totals.contacts} client contact${totals.contacts === 1 ? "" : "s"}, ${totals.archives} filed email archive${totals.archives === 1 ? "" : "s"}, and ${totals.meetings} meeting record${totals.meetings === 1 ? "" : "s"}.`,
      citations: matchingEvidence(evidence, [summaryCitation, projectCitation]),
      missingEvidence: "Raw Drive files, full email bodies, tasks, shifts, and records outside the bounded evidence set are not available to the assistant yet.",
    };
  }

  return {
    ...base,
    answer: `The saved records do not contain a direct answer to “${compact(question, 180)}”. ${project.project_number} — ${project.name} for ${project.client_name} is currently ${project.status}.`,
    citations: matchingEvidence(evidence, [projectCitation, summaryCitation]),
    missingEvidence: "Ask about current status, the primary contact, filed email archives, meetings, or available evidence. Raw Drive files and full email bodies are not indexed yet.",
  };
}
