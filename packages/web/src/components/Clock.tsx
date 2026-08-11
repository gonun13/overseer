import { useEffect, useState } from "react";
import { GearIcon } from "./icons";

/** Top-right, permanent: wall clock and the way into settings. An operator
 * watching long-running work needs the time without leaving the field. */
export function Clock({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-GB", { hour12: false });
  const date = now
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    })
    .toLowerCase();

  return (
    <div className="clock">
      <div className="clock-read">
        <span className="clock-time">{time}</span>
        <span className="clock-date">{date}</span>
      </div>
      <button
        className="gear-btn"
        onClick={onOpenSettings}
        aria-label="settings"
      >
        <GearIcon />
      </button>
    </div>
  );
}
