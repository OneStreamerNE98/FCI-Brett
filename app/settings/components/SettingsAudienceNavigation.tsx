"use client";

import { useEffect, useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FeatureStateBadge, type FeatureState } from "../../components/FeatureStateBadge";
import { cachedGetJson } from "../../lib/client-get-cache";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionCatalogEntry,
} from "../../lib/operations-routes";
import {
  calendarSettingsFeatureState,
  directorySettingsFeatureState,
  SETTINGS_CALENDAR_STATUS_PATH,
  SETTINGS_DIRECTORY_STATUS_PATH,
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
  const stateId = useId();
  return <button
    className={current === entry.label ? "active" : ""}
    aria-current={current === entry.label ? "page" : undefined}
    aria-label={entry.navigationLabel}
    aria-describedby={stateId}
    data-settings-feature-state={state}
    type="button"
    onClick={() => onSection(entry.label)}
  >
    <span className={styles.sectionLabel}>{entry.navigationLabel}</span>
    <span className={styles.badge} aria-hidden="true"><FeatureStateBadge state={state} variant="compact" /></span>
    <span className="sr-only" id={stateId}>{state}</span>
    <ChevronRight size={15} aria-hidden="true" />
  </button>;
}

export function SettingsAudienceNavigation({ section, isAdmin, onSection }: { section: SettingsSection; isAdmin: boolean; onSection: (section: SettingsSection) => void }) {
  const current = isAdmin ? section : PERSONAL_SECTION;
  const [computedFeatureStates, setComputedFeatureStates] = useState<ComputedFeatureStates>({});

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void Promise.allSettled([
      cachedGetJson<unknown>(SETTINGS_CALENDAR_STATUS_PATH),
      cachedGetJson<unknown>(SETTINGS_DIRECTORY_STATUS_PATH),
    ]).then(([calendarResult, directoryResult]) => {
      if (!active) return;
      setComputedFeatureStates({
        "Calendar & appointments": calendarResult.status === "fulfilled"
          ? calendarSettingsFeatureState(calendarResult.value)
          : "Setup required",
        "Client Directory": directoryResult.status === "fulfilled"
          ? directorySettingsFeatureState(directoryResult.value)
          : "Setup required",
      });
    });
    return () => {
      active = false;
    };
  }, [isAdmin]);

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
