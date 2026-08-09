import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { NavRail } from "./components/NavRail";
import { ConsoleZone } from "./components/zones/ConsoleZone";
import { SessionsZone } from "./components/zones/SessionsZone";
import { ApprovalsZone } from "./components/zones/ApprovalsZone";
import { CapabilitiesZone } from "./components/zones/CapabilitiesZone";
import { SystemZone } from "./components/zones/SystemZone";
import { ZONES, type ZoneId } from "./zones";
import { mockApprovals } from "./data/mock";

const ZONE_KEYS: Record<string, ZoneId> = Object.fromEntries(
  ZONES.map((z, i) => [String(i + 1), z.id]),
);

export default function App() {
  const [zone, setZone] = useState<ZoneId>("console");
  const [theme, setTheme] = useState<"machine" | "samaritan">("machine");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      const next = ZONE_KEYS[e.key];
      if (next) setZone(next);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div data-theme={theme} className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      <div className="scanline-overlay" />
      <TopBar
        pendingApprovals={mockApprovals.length}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "machine" ? "samaritan" : "machine"))}
      />
      <div className="flex min-h-0 flex-1">
        <NavRail active={zone} onSelect={setZone} />
        <div className="min-w-0 flex-1">
          {zone === "console" && <ConsoleZone />}
          {zone === "sessions" && <SessionsZone />}
          {zone === "approvals" && <ApprovalsZone />}
          {zone === "capabilities" && <CapabilitiesZone />}
          {zone === "system" && <SystemZone />}
        </div>
      </div>
    </div>
  );
}
