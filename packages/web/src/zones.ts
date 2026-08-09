export const ZONES = [
  { id: "console", num: "01", label: "Console" },
  { id: "sessions", num: "02", label: "Sessions" },
  { id: "approvals", num: "03", label: "Approvals" },
  { id: "capabilities", num: "04", label: "Capabilities" },
  { id: "system", num: "05", label: "System" },
] as const;

export type ZoneId = (typeof ZONES)[number]["id"];
