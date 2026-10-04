import { CALLSIGN_PATTERN } from "@overseer/protocol";
import { readCallsigns, writeCallsigns } from "./memory/internal.js";

/**
 * Callsigns — a person's name for every agent session, so the operator and
 * other agents can address it (spec/behaviour/relay.md §1).
 *
 * A name is keyed by the session id when the CLI runs a known session, and
 * persisted in internal memory so a resumed or dormant session keeps it. A
 * console whose CLI did not adopt an id is keyed by its console id instead,
 * and that name lives only as long as the console.
 */

/**
 * Taken in order: the first name nobody holds. Short, easy to type, distinct,
 * and none a prefix of another, so `@` completion never stalls on two.
 */
export const CALLSIGN_POOL: readonly string[] = [
  "Linda", "Bob", "Alice", "Carlos", "Dana", "Elena", "Felix", "Grace",
  "Hugo", "Iris", "Jonas", "Kira", "Leo", "Maya", "Nico", "Olga",
  "Paolo", "Quinn", "Rosa", "Sam", "Tara", "Umar", "Vera", "Walt",
  "Xena", "Yusuf", "Zoe", "Ada", "Bruno", "Clara", "Diego", "Emil",
  "Freya", "Gus", "Hana", "Ivan", "Jade", "Kai", "Lena", "Milo",
  "Nora", "Otto", "Pia", "Rafa", "Sofia", "Theo", "Vito", "Wren",
  "Yara", "Zane", "Abel", "Bea", "Cyrus", "Dora", "Ezra", "Fay",
  "Gil", "Hal", "Ines", "Mira",
];

/** Names that would read as something other than an agent. */
const RESERVED = new Set(["overseer", "operator"]);

export type RenameResult = { ok: true; key: string } | { ok: false; reason: string };

export interface CallsignBookDeps {
  read?: () => Promise<Record<string, string>>;
  write?: (map: Record<string, string>) => Promise<void>;
  /** Whether a key still names something — a listed session or a console.
   * Only asked when the pool runs out, to reclaim names first. */
  exists?: (key: string) => boolean;
}

export interface CallsignBook {
  /** Settles once the persisted map is loaded. Every other method is
   * synchronous and assumes it has. */
  ready: Promise<void>;
  /** The key's callsign, assigning one if it has none. */
  assign(key: string, persist: boolean): string;
  nameOf(key: string): string | undefined;
  /** The key holding `callsign`, ignoring case. */
  keyOf(callsign: string): string | undefined;
  /** Hand a name to another key — a console whose CLI did not adopt the
   * session id it was given keeps the name it was assigned under. */
  move(from: string, to: string, persist: boolean): void;
  rename(from: string, to: string): RenameResult;
  release(key: string): void;
  /** Forget everything except `keep` — a reset leaves running consoles
   * their names. Nothing is re-persisted: the reset erased the file. */
  forget(keep: Iterable<string>): void;
}

export function createCallsignBook(deps: CallsignBookDeps = {}): CallsignBook {
  const read = deps.read ?? readCallsigns;
  const write = deps.write ?? writeCallsigns;
  const exists = deps.exists ?? (() => true);

  /** key → callsign, for every key. */
  const names = new Map<string, string>();
  /** The keys written to disk — session ids, never console ids. */
  const persisted = new Set<string>();

  const ready = read().then(
    (map) => {
      for (const [key, name] of Object.entries(map)) {
        // A name assigned before the load finished wins over the file.
        if (names.has(key)) continue;
        names.set(key, name);
        persisted.add(key);
      }
    },
    () => undefined,
  );

  const save = () => {
    const map: Record<string, string> = {};
    for (const key of persisted) {
      const name = names.get(key);
      if (name !== undefined) map[key] = name;
    }
    void write(map).catch(() => undefined);
  };

  const keyOf = (callsign: string): string | undefined => {
    const needle = callsign.toLowerCase();
    for (const [key, name] of names) {
      if (name.toLowerCase() === needle) return key;
    }
    return undefined;
  };

  const held = () => new Set([...names.values()].map((name) => name.toLowerCase()));

  const pick = (): string => {
    const taken = held();
    const free = CALLSIGN_POOL.find((name) => !taken.has(name.toLowerCase()));
    if (free !== undefined) return free;
    // Reclaim a pool name from a session that no longer exists.
    for (const name of CALLSIGN_POOL) {
      const key = keyOf(name)!;
      if (exists(key)) continue;
      names.delete(key);
      persisted.delete(key);
      return name;
    }
    for (let n = 2; ; n++) {
      const numbered = CALLSIGN_POOL.find((name) => !taken.has(`${name}${n}`.toLowerCase()));
      if (numbered !== undefined) return `${numbered}${n}`;
    }
  };

  return {
    ready,

    assign(key, persist) {
      const existing = names.get(key);
      if (existing !== undefined) return existing;
      const name = pick();
      names.set(key, name);
      if (persist) {
        persisted.add(key);
        save();
      }
      return name;
    },

    nameOf: (key) => names.get(key),

    keyOf,

    move(from, to, persist) {
      const name = names.get(from);
      if (name === undefined || from === to) return;
      const wasPersisted = persisted.delete(from);
      names.delete(from);
      names.set(to, name);
      if (persist) persisted.add(to);
      if (wasPersisted || persist) save();
    },

    rename(from, to) {
      const key = keyOf(from);
      if (key === undefined) return { ok: false, reason: `no agent called ${from}` };
      if (!CALLSIGN_PATTERN.test(to)) {
        return {
          ok: false,
          reason: "a callsign is 2–16 letters, digits or hyphens, starting with a letter",
        };
      }
      if (RESERVED.has(to.toLowerCase())) return { ok: false, reason: `${to} is reserved` };
      const holder = keyOf(to);
      if (holder !== undefined && holder !== key) {
        return { ok: false, reason: `${names.get(holder)} is already taken` };
      }
      names.set(key, to);
      if (persisted.has(key)) save();
      return { ok: true, key };
    },

    release(key) {
      if (!names.delete(key)) return;
      if (persisted.delete(key)) save();
    },

    forget(keep) {
      const kept = new Set(keep);
      for (const key of [...names.keys()]) {
        if (kept.has(key)) continue;
        names.delete(key);
        persisted.delete(key);
      }
    },
  };
}
