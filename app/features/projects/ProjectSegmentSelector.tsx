"use client";

import { useId } from "react";
import { PROJECT_SEGMENTS } from "../../domain/project-segment";
import styles from "./ProjectSegmentSelector.module.css";

const SEGMENT_LABELS = {
  commercial: "Commercial",
  residential: "Residential",
} as const;

export function ProjectSegmentSelector() {
  const helpId = useId();

  return (
    <fieldset className={styles.fieldset} aria-describedby={helpId}>
      <legend className={styles.legend}>
        Project segment <span className={styles.optional}>Optional</span>
      </legend>
      <p className={styles.help} id={helpId}>
        Choose Derived or leave unselected to use the client industry: Residential clients default to Residential; every other client defaults to Commercial.
      </p>
      <div className={styles.options}>
        {PROJECT_SEGMENTS.map((segment) => (
          <label className={styles.option} key={segment}>
            <input type="radio" name="segment" value={segment} aria-describedby={helpId} />
            <span>{SEGMENT_LABELS[segment]}</span>
          </label>
        ))}
        <label className={styles.option}>
          <input type="radio" name="segment" value="" aria-describedby={helpId} />
          <span>Derived</span>
        </label>
      </div>
    </fieldset>
  );
}
