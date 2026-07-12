"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Download, Share2, Smartphone } from "lucide-react";

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
    <ol className="fci-phone-install-steps">
      <li>Open this site in Chrome on your phone.</li>
      <li>Tap the browser menu (⋮).</li>
      <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
    </ol>
  );

  const iosInstructions = (
    <ol className="fci-phone-install-steps">
      <li>Open this site in <strong>Safari</strong> on your iPhone or iPad.</li>
      <li>Tap <Share2 aria-label="Share" size={15} strokeWidth={2.2} className="fci-phone-install-inline-icon" /> <strong>Share</strong>.</li>
      <li>Choose <strong>Add to Home Screen</strong>, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>
    </ol>
  );

  return (
    <section className="fci-phone-install-panel" aria-labelledby="phone-install-title">
      <style>{`
        .fci-phone-install-panel {
          border: 1px solid rgba(109, 99, 91, .2);
          border-radius: 16px;
          background: linear-gradient(135deg, #f8f6f2, #fff);
          color: #312b28;
          padding: 18px;
        }
        .settings-security-list + .fci-phone-install-panel { margin-top: 16px; }
        .fci-phone-install-heading { display: flex; align-items: flex-start; gap: 12px; }
        .fci-phone-install-icon {
          display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px;
          border-radius: 11px; background: #e9e2da; color: #564a42;
        }
        .fci-phone-install-heading h3 { margin: 0; font: 700 15px/1.25 var(--font-display, sans-serif); }
        .fci-phone-install-heading p { margin: 4px 0 0; color: #716862; font-size: 13px; line-height: 1.45; }
        .fci-phone-install-action {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
          margin: 15px 0 2px; border: 0; border-radius: 10px; padding: 10px 14px;
          background: #564a42; color: #fff; cursor: pointer; font: 700 13px/1.2 var(--font-body, sans-serif);
        }
        .fci-phone-install-action:hover { background: #40362f; }
        .fci-phone-install-action:focus-visible { outline: 3px solid #b99869; outline-offset: 2px; }
        .fci-phone-install-status { display: flex; align-items: center; gap: 7px; margin: 14px 0 0; color: #37634b; font-size: 13px; font-weight: 700; }
        .fci-phone-install-copy { margin: 14px 0 0; color: #625951; font-size: 13px; line-height: 1.45; }
        .fci-phone-install-steps { margin: 9px 0 0; padding-left: 22px; color: #514841; font-size: 13px; line-height: 1.65; }
        .fci-phone-install-inline-icon { display: inline; vertical-align: -2px; margin-right: 2px; }
        .fci-phone-install-note { margin: 12px 0 0; color: #837970; font-size: 12px; line-height: 1.45; }
        @media (min-width: 640px) {
          .fci-phone-install-panel { padding: 20px; }
          .fci-phone-install-action { width: auto; min-width: 190px; }
        }
      `}</style>

      <div className="fci-phone-install-heading">
        <span className="fci-phone-install-icon" aria-hidden="true"><Smartphone size={20} /></span>
        <div>
          <h3 id="phone-install-title">Use FCI Operations like a phone app</h3>
          <p>Install the secure web app to your home screen. It opens in its own window—there is nothing to upload to Google Drive.</p>
        </div>
      </div>

      {installed ? (
        <p className="fci-phone-install-status"><CheckCircle2 size={16} aria-hidden="true" /> Installed on this device</p>
      ) : deferredPrompt ? (
        <button type="button" className="fci-phone-install-action" onClick={requestInstall}>
          <Download size={16} aria-hidden="true" /> Install FCI Operations
        </button>
      ) : (
        <>
          <p className="fci-phone-install-copy">
            {platform === "ios" ? "Use Safari’s Share menu to add this app to your home screen." : platform === "android" ? "Use Chrome’s menu to add this app to your home screen." : "Open this site in your phone’s browser to add it to the home screen."}
          </p>
          {platform === "ios" ? iosInstructions : platform === "android" ? androidInstructions : null}
        </>
      )}

      {installMessage ? <p className="fci-phone-install-note" aria-live="polite">{installMessage}</p> : null}
      {!installed ? <p className="fci-phone-install-note">Install availability depends on the browser and whether the site is opened outside an in-app browser.</p> : null}
    </section>
  );
}

export default PhoneInstallPanel;
