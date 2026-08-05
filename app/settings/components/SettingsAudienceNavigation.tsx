"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { FeatureState } from "../../components/FeatureStateBadge";
import { cachedGetJson } from "../../lib/client-get-cache";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionCatalogEntry,
} from "../../lib/operations-routes";
import type { SheetMirrorStatus } from "../../lib/sheet-mirror-status";
import {
  calendarSettingsFeatureState,
  directorySettingsFeatureState,
  SETTINGS_CALENDAR_STATUS_PATH,
} from "../../lib/settings-feature-state";
import styles from "./SettingsAudienceNavigation.module.css";

const PERSONAL_SECTION: SettingsSection = "My settings";
const PERSONAL_SECTION_ENTRY = SETTINGS_SECTIONS.find((entry) => entry.label === PERSONAL_SECTION)!;
const COMPANY_SECTIONS = SETTINGS_SECTIONS.filter((entry) => entry.label !== PERSONAL_SECTION);

type ComputedFeatureStates = Partial<Record<SettingsSection, FeatureState>>;

function SectionButton({ entry, state, current, onSection }: {
  entry: SettingsSectionCatalogEntry;
  state: FeatureState;
  current: SettingsSection;
  onSection: (section: SettingsSection) => void;
}) {
  return <button
    className={current === entry.label ? "active" : ""}
    aria-current={current === entry.label ? "page" : undefined}
    aria-label={entry.navigationLabel}
    data-settings-feature-state={state}
    type="button"
    onClick={() => onSection(entry.label)}
  >
    <span className={styles.sectionLabel}>{entry.navigationLabel}</span>
    <ChevronRight size={15} aria-hidden="true" />
  </button>;
}

export function SettingsAudienceNavigation({ section, isAdmin, sheetMirror, onSection }: { section: SettingsSection; isAdmin: boolean; sheetMirror: SheetMirrorStatus | null; onSection: (section: SettingsSection) => void }) {
  const current = isAdmin ? section : PERSONAL_SECTION;
  const [calendarFeatureState, setCalendarFeatureState] = useState<FeatureState | null>(null);

  // Only the calendar state needs its own read: /api/v1/google-workspace is fetched through
  // cachedGetJson by every other panel that wants it, so this shares their in-flight request.
  // The Sheet mirror deliberately does NOT get one — the app shell already loads it with a raw
  // fetch that cannot dedupe against this cache, so reading it here would issue a second
  // request on every admin Settings load.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void cachedGetJson<unknown>(SETTINGS_CALENDAR_STATUS_PATH).then(
      (payload) => {
        if (active) setCalendarFeatureState(calendarSettingsFeatureState(payload));
      },
      () => {
        if (active) setCalendarFeatureState("Setup required");
      },
    );
    return () => {
      active = false;
    };
  }, [isAdmin]);

  // The Client Directory row reflects the mirror the app shell already holds. While that
  // bootstrap read is still in flight the mirror is null, which yields "Setup required" — the
  // same value the catalog carries as its fallback, so the first paint is unchanged.
  const computedFeatureStates: ComputedFeatureStates = {
    "Client Directory": directorySettingsFeatureState({ mirror: sheetMirror }),
    ...(calendarFeatureState === null ? {} : { "Calendar & appointments": calendarFeatureState }),
  };

  return <aside className="settings-nav panel" aria-label="Settings sections">
    <nav className={styles.navigation}>
      <section aria-labelledby="personal-settings-navigation-heading">
        <p className={styles.audienceLabel} id="personal-settings-navigation-heading">For you</p>
        <SectionButton entry={PERSONAL_SECTION_ENTRY} state={PERSONAL_SECTION_ENTRY.featureState} current={current} onSection={onSection} />
      </section>
      {isAdmin && <section aria-labelledby="company-settings-navigation-heading">
        <p className={styles.audienceLabel} id="company-settings-navigation-heading">Workspace &amp; company setup</p>
        {COMPANY_SECTIONS.map((entry) => <SectionButton
          key={entry.label}
          entry={entry}
          state={computedFeatureStates[entry.label] ?? entry.featureState}
          current={current}
          onSection={onSection}
        />)}
      </section>}
    </nav>
  </aside>;
}
