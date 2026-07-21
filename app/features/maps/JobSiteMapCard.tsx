import { ExternalLink, MapPinned, Navigation, Satellite } from "lucide-react";
import {
  resolveJobSiteMapState,
  type JobSiteLocation,
  type JobSiteMapsRuntimeConfig,
} from "./job-site-map";

type JobSiteMapCardProps = Readonly<{
  location: JobSiteLocation | null;
  runtime: JobSiteMapsRuntimeConfig;
  contextLabel: string;
}>;

const STATE_LABELS = {
  "no-address": "Address needed",
  simulation: "Simulated",
  "missing-key": "Setup required",
  live: "Satellite view",
} as const;

export function JobSiteMapCard({ location, runtime, contextLabel }: JobSiteMapCardProps) {
  const state = resolveJobSiteMapState(location, runtime);
  const displayedLocation = state.location?.address ?? (state.destination ? `Coordinates ${state.destination}` : null);

  return (
    <section
      className={`job-site-map-card job-site-map-card-${state.kind}`}
      data-map-state={state.kind}
      aria-label={`Job-site map and directions for ${contextLabel}`}
    >
      <header>
        <div>
          <p className="eyebrow">Site logistics</p>
          <h3>Job-site map &amp; navigation</h3>
        </div>
        <span className="job-site-map-state">{STATE_LABELS[state.kind]}</span>
      </header>

      {state.kind === "live" && state.embedUrl ? (
        <div className="job-site-map-frame">
          <iframe
            title={`Satellite map for ${contextLabel}`}
            src={state.embedUrl}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="job-site-map-placeholder">
          {state.kind === "simulation" ? <Satellite size={24} aria-hidden="true" /> : <MapPinned size={24} aria-hidden="true" />}
          <div>
            <strong>
              {state.kind === "no-address"
                ? "No job-site address is stored"
                : state.kind === "simulation"
                  ? "Satellite preview placeholder"
                  : "Satellite view is waiting for Maps setup"}
            </strong>
            <span>
              {state.kind === "no-address"
                ? "Add a job-site address or validated geocode to show the map and directions."
                : state.kind === "simulation"
                  ? "Simulation shows this placeholder without loading Google Maps."
                  : "The restricted Maps browser key is not configured. Keyless directions remain available."}
            </span>
          </div>
        </div>
      )}

      <footer>
        <span>{displayedLocation ?? "No location available"}</span>
        {state.directionsUrl ? (
          <a
            href={state.directionsUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open directions to ${contextLabel} in Google Maps`}
          >
            <Navigation size={15} aria-hidden="true" />
            Open directions
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : null}
      </footer>
    </section>
  );
}
