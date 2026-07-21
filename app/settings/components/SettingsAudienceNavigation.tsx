"use client";

import { ChevronRight } from "lucide-react";
import { SETTINGS_SECTIONS, type SettingsSection } from "../../lib/operations-routes";
import styles from "./SettingsAudienceNavigation.module.css";

const PERSONAL_SECTION: SettingsSection = "My account";
const COMPANY_SECTIONS = SETTINGS_SECTIONS.filter((section) => section !== PERSONAL_SECTION);

function SectionButton({ section, label, current, onSection }: { section: SettingsSection; label: string; current: SettingsSection; onSection: (section: SettingsSection) => void }) {
  return <button className={current === section ? "active" : ""} aria-current={current === section ? "page" : undefined} type="button" onClick={() => onSection(section)}>{label}<ChevronRight size={15} aria-hidden="true" /></button>;
}

export function SettingsAudienceNavigation({ section, isAdmin, onSection }: { section: SettingsSection; isAdmin: boolean; onSection: (section: SettingsSection) => void }) {
  const current = isAdmin ? section : PERSONAL_SECTION;
  return <aside className="settings-nav panel" aria-label="Settings sections">
    <nav className={styles.navigation}>
      <section aria-labelledby="personal-settings-navigation-heading">
        <p className={styles.audienceLabel} id="personal-settings-navigation-heading">For you</p>
        <SectionButton section={PERSONAL_SECTION} label="My settings" current={current} onSection={onSection} />
      </section>
      {isAdmin && <section aria-labelledby="company-settings-navigation-heading">
        <p className={styles.audienceLabel} id="company-settings-navigation-heading">Workspace &amp; company setup</p>
        {COMPANY_SECTIONS.map((companySection) => <SectionButton key={companySection} section={companySection} label={companySection} current={current} onSection={onSection} />)}
      </section>}
    </nav>
  </aside>;
}
