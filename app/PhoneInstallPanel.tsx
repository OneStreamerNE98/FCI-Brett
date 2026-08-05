"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Download, Share2, Smartphone } from "lucide-react";
import styles from "./PhoneInstallPanel.module.css";

type InstallPlatform = "android" | "ios" | "other";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function detectPlatform(userAgent: string): InstallPlatform {
  const normalized = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(normalized)) return "ios";
  if (/android/.test(normalized)) return "android";
  return "other";
}

function getPlatformSnapshot(): InstallPlatform {
  return detectPlatform(window.navigator.userAgent);
}

function getServerPlatformSnapshot(): InstallPlatform {
  return "other";
}

function subscribeToPlatform() {
  return () => undefined;
}

function getInstalledSnapshot() {
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(displayMode || iosStandalone);
}

function getServerInstalledSnapshot() {
  return false;
}

function subscribeToInstalledState(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia?.("(display-mode: standalone)");
  const handleMediaChange = () => onStoreChange();
  mediaQuery?.addEventListener?.("change", handleMediaChange);
  window.addEventListener("appinstalled", onStoreChange);
  return () => {
    mediaQuery?.removeEventListener?.("change", handleMediaChange);
    window.removeEventListener("appinstalled", onStoreChange);
  };
}

/**
 * A self-contained installation helper for the published PWA.
 *
 * It deliberately never opens an install prompt on its own: Chrome/Edge only
 * receive the native prompt after the user presses the button themselves.
 */
export function PhoneInstallPanel() {
  const platform = useSyncExternalStore(subscribeToPlatform, getPlatformSnapshot, getServerPlatformSnapshot);
  const installed = useSyncExternalStore(subscribeToInstalledState, getInstalledSnapshot, getServerInstalledSnapshot);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState("");

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      // Retain the browser's prompt until the user explicitly requests it.
      installEvent.preventDefault();
      setDeferredPrompt(installEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setInstallMessage("FCI Operations is installed on this device.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const requestInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setInstallMessage(choice.outcome === "accepted" ? "Install started. You can open FCI Operations from your home screen." : "Install was not completed. You can try again from your browser menu.");
    } catch {
      setInstallMessage("Your browser could not open the install prompt. Use its Add to Home Screen or Install app menu instead.");
    } finally {
      setDeferredPrompt(null);
    }
  };

  const androidInstructions = (
    <ol className={styles.steps}>
      <li>Open this site in Chrome on your phone.</li>
      <li>Tap the browser menu (⋮).</li>
      <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
    </ol>
  );

  const iosInstructions = (
    <ol className={styles.steps}>
      <li>Open this site in <strong>Safari</strong> on your iPhone or iPad.</li>
      <li>Tap <Share2 aria-label="Share" size={15} strokeWidth={2.2} className={styles.inlineIcon} /> <strong>Share</strong>.</li>
      <li>Choose <strong>Add to Home Screen</strong>, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>
    </ol>
  );

  return (
    <section className={styles.panel} aria-labelledby="phone-install-title">
      <div className={styles.heading}>
        <span className={styles.icon} aria-hidden="true"><Smartphone size={20} /></span>
        <div>
          <h3 id="phone-install-title">Use FCI Operations like a phone app</h3>
          <p>Install the secure web app to your home screen. It opens in its own window—there is nothing to upload to Google Drive.</p>
        </div>
      </div>

      {installed ? (
        <p className={styles.status}><CheckCircle2 size={16} aria-hidden="true" /> Installed on this device</p>
      ) : deferredPrompt ? (
        <button type="button" className={styles.action} onClick={requestInstall}>
          <Download size={16} aria-hidden="true" /> Install FCI Operations
        </button>
      ) : (
        <>
          <p className={styles.copy}>
            {platform === "ios" ? "Use Safari’s Share menu to add this app to your home screen." : platform === "android" ? "Use Chrome’s menu to add this app to your home screen." : "Open this site in your phone’s browser to add it to the home screen."}
          </p>
          {platform === "ios" ? iosInstructions : platform === "android" ? androidInstructions : null}
        </>
      )}

      {installMessage ? <p className={styles.note} aria-live="polite">{installMessage}</p> : null}
      {!installed ? <p className={styles.note}>Install availability depends on the browser and whether the site is opened outside an in-app browser.</p> : null}
    </section>
  );
}

export default PhoneInstallPanel;
