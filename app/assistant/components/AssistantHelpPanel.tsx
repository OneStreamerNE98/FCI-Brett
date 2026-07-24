import { ChevronDown, CircleHelp, ShieldCheck } from "lucide-react";
import styles from "./AssistantHelpPanel.module.css";

const ASSISTANT_EXAMPLE_QUESTIONS = [
  "Which projects have open callbacks?",
  "What did we decide in the last Hendricks meeting?",
  "What tasks are overdue?",
  "Show installation dates for active commercial projects.",
  "Find the change order document for project 2026-014.",
] as const;

export function AssistantHelpPanel() {
  return <section className={`panel ${styles.panel}`} aria-label="Assistant help">
    <details>
      <summary>
        <span><CircleHelp size={18} aria-hidden="true" /> What you can ask</span>
        <ChevronDown className={styles.chevron} size={18} aria-hidden="true" />
      </summary>
      <div className={styles.content}>
        <p>Answers come only from saved records and Drive files. Every answer cites its sources. The assistant never sends anything.</p>
        <ul>{ASSISTANT_EXAMPLE_QUESTIONS.map((question) => <li key={question}>{question}</li>)}</ul>
        <p className={styles.limit}><ShieldCheck size={16} aria-hidden="true" /> <span>Email bodies live in Drive as filed copies — file an email first if you want it searchable. Phone calls are saved as meetings.</span></p>
      </div>
    </details>
  </section>;
}
