"use client";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function InstallApp() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !promptEvent) return null;
  const install = async () => {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setPromptEvent(null);
  };
  return <button type="button" onClick={install} aria-label="تثبيت تطبيق BTC RADAR" style={{
    position: "fixed", zIndex: 1000, bottom: "max(16px, env(safe-area-inset-bottom))",
    left: 16, border: "1px solid #54704f", borderRadius: 999, padding: "11px 16px",
    background: "#18352f", color: "#eaf7f1", font: "600 13px Arial, sans-serif",
    boxShadow: "0 8px 28px #0008", cursor: "pointer"
  }}>⬇ تثبيت BTC RADAR</button>;
}