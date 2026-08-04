"use client";

import { Check, LoaderCircle, MapPin, Search } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

import type {
  AddressEntityKind,
  AddressReviewReference,
  AddressReviewVerdict,
} from "../../domain/address-validation";
import type { JobSiteMapsRuntimeConfig } from "../maps/job-site-map";
import {
  addressAvailabilityHint,
  createAddressAutocompleteSession,
  placesAutocompleteBrowserKey,
  type AddressAutocompleteSession,
} from "./address-autocomplete-session";
import styles from "./AddressValidationField.module.css";

const PLACES_AUTOCOMPLETE_ENDPOINT =
  "https://places.googleapis.com/v1/places:autocomplete";
const SIMULATION_SUGGESTION = "123 Test Street, Portland, ME 04101";

type ReviewResponse = Readonly<{
  id: string;
  inputAddress: string;
  standardizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  verdict: AddressReviewVerdict;
  failureCode: string | null;
  simulated: boolean;
  expiresAt: number;
}>;

function liveSuggestions(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const suggestions = (payload as Record<string, unknown>).suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((suggestion) => {
    if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) return [];
    const prediction = (suggestion as Record<string, unknown>).placePrediction;
    if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) return [];
    const text = (prediction as Record<string, unknown>).text;
    if (!text || typeof text !== "object" || Array.isArray(text)) return [];
    const value = (text as Record<string, unknown>).text;
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  }).slice(0, 5);
}

export function AddressValidationField({
  id,
  name,
  label,
  value,
  required = false,
  disabled = false,
  entityKind,
  targetId,
  mapsRuntime,
  onChange,
  onReviewChange,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  entityKind: AddressEntityKind;
  targetId: string;
  mapsRuntime: JobSiteMapsRuntimeConfig;
  onChange: (value: string) => void;
  onReviewChange: (review: AddressReviewReference | null) => void;
}>) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [choice, setChoice] = useState<AddressReviewReference["choice"] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [validating, setValidating] = useState(false);
  const [tokenizedAutocompleteStarted, setTokenizedAutocompleteStarted] = useState(false);
  const [userEditedAddress, setUserEditedAddress] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The value present at mount is a seed (edit modals, inbox prefill), not a
  // user edit. It must never start a billable autocomplete session.
  const seededValueRef = useRef(value);
  const sessionRef = useRef<AddressAutocompleteSession | null>(null);
  sessionRef.current ??= createAddressAutocompleteSession();
  const suggestionRequestRef = useRef(0);
  const suggestionAbortRef = useRef<AbortController | null>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const acceptedSuggestionRef = useRef<string | null>(null);
  const liveAutocompleteApiKey = placesAutocompleteBrowserKey(mapsRuntime);
  const availabilityHint = addressAvailabilityHint(mapsRuntime);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity(
      review && choice === null
        ? "Choose the standardized suggestion or explicitly keep the typed address."
        : tokenizedAutocompleteStarted && userEditedAddress
          // Only an address the user actually edited this session, with
          // autocomplete used on that edit, may block Save. An untouched
          // seeded address never blocks an unrelated edit from saving.
          ? "Review this address before saving because autocomplete was used."
          : "",
    );
  }, [choice, review, tokenizedAutocompleteStarted, userEditedAddress]);

  useEffect(() => () => {
    // Cancel/navigation must never cause a hidden validation write. Dropping
    // the local token prevents reuse; Google bills any already-issued
    // autocomplete requests in that abandoned session per request.
    suggestionAbortRef.current?.abort();
    reviewAbortRef.current?.abort();
    sessionRef.current?.complete();
  }, []);

  useEffect(() => {
    const query = value.trim();
    if (
      disabled
      || validating
      // Mount, seeding, and rehydration never fire a request: suggestions may
      // start only after the user edited the field and moved it off the seed.
      || !userEditedAddress
      || value === seededValueRef.current
      || query.length < 3
      || review
      || acceptedSuggestionRef.current === value
    ) {
      return;
    }
    const requestId = suggestionRequestRef.current + 1;
    suggestionRequestRef.current = requestId;
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    const timeout = window.setTimeout(async () => {
      if (suggestionRequestRef.current !== requestId) return;
      if (mapsRuntime.simulation) {
        if (suggestionRequestRef.current === requestId) {
          const normalized = query.toLowerCase();
          setSuggestions(
            SIMULATION_SUGGESTION.toLowerCase().includes(normalized)
              || normalized.includes("123 test")
              ? [SIMULATION_SUGGESTION]
              : [],
          );
          setActiveSuggestion(-1);
        }
        return;
      }
      const apiKey = liveAutocompleteApiKey;
      if (!apiKey) return;
      const token = sessionRef.current.token();
      setTokenizedAutocompleteStarted(true);
      setLoadingSuggestions(true);
      try {
        const response = await fetch(PLACES_AUTOCOMPLETE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "suggestions.placePrediction.text.text,suggestions.placePrediction.placeId",
          },
          body: JSON.stringify({
            input: query,
            sessionToken: token,
            includedRegionCodes: ["us"],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Autocomplete unavailable");
        const next = liveSuggestions(await response.json());
        if (suggestionRequestRef.current === requestId) {
          setSuggestions(next);
          setActiveSuggestion(-1);
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (suggestionRequestRef.current === requestId) {
          setSuggestions([]);
          setActiveSuggestion(-1);
        }
      } finally {
        if (suggestionRequestRef.current === requestId) setLoadingSuggestions(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      if (suggestionAbortRef.current === controller) suggestionAbortRef.current = null;
    };
  }, [
    mapsRuntime.simulation,
    liveAutocompleteApiKey,
    disabled,
    review,
    userEditedAddress,
    validating,
    value,
  ]);

  function resetReview(nextValue: string, suppressSuggestions = false) {
    acceptedSuggestionRef.current = suppressSuggestions ? nextValue : null;
    if (!nextValue.trim()) {
      // An optional address may be cleared after autocomplete. Abandon that
      // provider session honestly so an empty field cannot become unsavable.
      sessionRef.current.complete();
      setTokenizedAutocompleteStarted(false);
    }
    setReview(null);
    setChoice(null);
    setSuggestions([]);
    setActiveSuggestion(-1);
    setError("");
    onReviewChange(null);
    onChange(nextValue);
  }

  async function requestReview() {
    const address = value.trim();
    if (!address) return;
    // Freeze this exact value and stop its debounce/in-flight request before
    // validation can terminate the shared session token.
    acceptedSuggestionRef.current = value;
    suggestionRequestRef.current += 1;
    suggestionAbortRef.current?.abort();
    suggestionAbortRef.current = null;
    const reviewController = new AbortController();
    reviewAbortRef.current = reviewController;
    const token = sessionRef.current.token();
    setValidating(true);
    setLoadingSuggestions(false);
    setError("");
    setSuggestions([]);
    try {
      const response = await fetch("/api/v1/address-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          entityKind,
          targetId,
          sessionToken: token,
        }),
        signal: reviewController.signal,
      });
      const payload = await response.json().catch(() => ({})) as {
        review?: ReviewResponse;
        error?: string;
      };
      if (!response.ok || !payload.review) {
        throw new Error(payload.error ?? "Address review is unavailable.");
      }
      setReview(payload.review);
      setChoice(null);
      onReviewChange(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Address review is unavailable.");
    } finally {
      // The browser cannot know whether a failed response happened before or
      // after provider validation. Conservatively close every settled review
      // attempt so no later request can reuse a possibly terminated token.
      sessionRef.current.complete();
      setTokenizedAutocompleteStarted(false);
      setValidating(false);
      if (reviewAbortRef.current === reviewController) reviewAbortRef.current = null;
    }
  }

  function choose(nextChoice: AddressReviewReference["choice"]) {
    if (!review) return;
    const reference = { id: review.id, choice: nextChoice } as const;
    setChoice(nextChoice);
    onReviewChange(reference);
  }

  function acceptSuggestion(suggestion: string) {
    resetReview(suggestion, true);
    inputRef.current?.focus();
  }

  function dismissSuggestions() {
    setSuggestions([]);
    setActiveSuggestion(-1);
  }

  function handleFieldBlur(event: FocusEvent<HTMLDivElement>) {
    // Moving focus anywhere inside the field group (input, listbox options,
    // Review button) keeps the listbox; leaving the group dismisses it so it
    // can never keep floating over unrelated controls.
    if (
      event.relatedTarget instanceof Node
      && event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    dismissSuggestions();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (visibleSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => current >= visibleSuggestions.length - 1 ? 0 : current + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => current <= 0 ? visibleSuggestions.length - 1 : current - 1);
      return;
    }
    if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      acceptSuggestion(visibleSuggestions[activeSuggestion]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissSuggestions();
    }
  }

  const hasStandardizedChoice = Boolean(
    review?.standardizedAddress
    && review.latitude !== null
    && review.longitude !== null
    && review.verdict !== "needs-correction"
    && review.verdict !== "unvalidated",
  );
  const suggestionsAvailable = !disabled && !review && value.trim().length >= 3;
  const visibleSuggestions = suggestionsAvailable ? suggestions : [];

  useEffect(() => {
    if (visibleSuggestions.length === 0) return;
    function handlePointerDown(event: PointerEvent) {
      const container = containerRef.current;
      if (!container) return;
      if (event.target instanceof Node && container.contains(event.target)) return;
      // A pointer press outside the field container dismisses the listbox
      // without accepting anything, so it cannot hijack a click aimed at a
      // control it happens to cover.
      setSuggestions([]);
      setActiveSuggestion(-1);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [visibleSuggestions.length]);

  return <div
    ref={containerRef}
    className={styles.field}
    data-address-validation-field={entityKind}
    onBlur={handleFieldBlur}
  >
    <div className={styles.labelRow}>
      <label className={styles.label} htmlFor={id}>
        {label}{required ? null : <span className="optional-label">Optional</span>}
      </label>
      <span className={styles.limit}>{value.length}/280</span>
    </div>
    <div className={styles.inputWrap}>
      <input
        ref={inputRef}
        className={styles.input}
        id={id}
        name={name}
        value={value}
        maxLength={280}
        required={required}
        disabled={disabled}
        autoComplete="street-address"
        role="combobox"
        aria-describedby={`${id}-address-status`}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={visibleSuggestions.length > 0}
        aria-invalid={tokenizedAutocompleteStarted && userEditedAddress
          || review !== null && choice === null}
        aria-controls={`${id}-address-suggestions`}
        aria-activedescendant={activeSuggestion >= 0 && visibleSuggestions.length > activeSuggestion
          ? `${id}-address-suggestion-${activeSuggestion}`
          : undefined}
        onChange={(event) => {
          setUserEditedAddress(true);
          resetReview(event.target.value);
        }}
        onKeyDown={handleInputKeyDown}
      />
      {visibleSuggestions.length > 0 && <div className={styles.suggestions}>
        <div
          className={styles.suggestionList}
          id={`${id}-address-suggestions`}
          role="listbox"
          aria-label="Address suggestions"
        >
          {visibleSuggestions.map((suggestion, index) => <button
            className={styles.suggestion}
            id={`${id}-address-suggestion-${index}`}
            key={`${suggestion}-${index}`}
            type="button"
            disabled={disabled}
            role="option"
            aria-selected={activeSuggestion === index}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => acceptSuggestion(suggestion)}
          >{suggestion}</button>)}
        </div>
        {!mapsRuntime.simulation
          && <span className={styles.attribution} translate="no">Google Maps</span>}
      </div>}
    </div>
    <div className={styles.actions}>
      <button
        className={styles.reviewButton}
        type="button"
        disabled={disabled || !value.trim() || validating}
        onClick={() => void requestReview()}
      >
        {validating
          ? <LoaderCircle className={styles.spinner} size={14} aria-hidden="true" />
          : <Search size={14} aria-hidden="true" />}
        {validating ? "Reviewing…" : review ? "Review again" : "Review address"}
      </button>
      {suggestionsAvailable && loadingSuggestions
        && <span className={styles.status}>Finding suggestions…</span>}
      {tokenizedAutocompleteStarted && !review && !validating
        && <span className={styles.hint}>
          Autocomplete was used. Review this address before saving so the session can end with validation.
        </span>}
      {availabilityHint && <span className={styles.hint}>{availabilityHint}</span>}
    </div>
    <div id={`${id}-address-status`} aria-live="polite">
      {error && <p className={`${styles.status} ${styles.warning}`} role="alert">{error}</p>}
      {review && <div className={styles.review} data-address-review-verdict={review.verdict}>
        <strong>{review.simulated ? "Simulated address review" : review.verdict === "validated" ? "Validated suggestion" : review.verdict === "needs-confirmation" ? "Please confirm this suggestion" : review.verdict === "needs-correction" ? "Address may need correction" : "Validation unavailable"}</strong>
        {review.standardizedAddress && <span className={styles.address}>
          <MapPin size={14} aria-hidden="true" /> {review.standardizedAddress}
        </span>}
        <p className={styles.status}>
          Your typed address stays unchanged until you choose. Keeping it saves an unvalidated flag and no coordinates.
        </p>
        <div className={styles.actions}>
          {hasStandardizedChoice && <button
            className={`${styles.choiceButton} ${styles.choiceButtonPrimary}`}
            type="button"
            onClick={() => choose("standardized")}
          ><Check size={14} aria-hidden="true" />Use standardized address</button>}
          <button
            className={styles.choiceButton}
            type="button"
            onClick={() => choose("typed")}
          >Keep typed address</button>
        </div>
        {choice && <span className={styles.confirmed}>
          <Check size={14} aria-hidden="true" /> {choice === "standardized" ? "Standardized address selected" : "Typed address selected"}
        </span>}
      </div>}
    </div>
  </div>;
}
