/** Transcript turn on the wire — shared between JSONL backfill and live UI. */
export type TurnWire =
  | { id: string; kind: "user" | "agent"; text: string }
  | { id: string; kind: "tool"; tool: string; target: string };
