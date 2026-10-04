import { useMemo } from "react";
import type { ConsoleInfo, HeldRelay, SpaceStatusEntry } from "@overseer/protocol";
import type { Project, ProviderInfo } from "../domain";
import { deriveSignals, messageFor, type Signal } from "./signals";
import { message as toneMessage } from "../lang";
import type { DiscoveryController } from "./useDiscovery";
import {
  furnitureFor,
  isLoading,
  nameAskPrefix,
  projectsFor,
  welcomeNeedsName,
  welcomeNeedsTone,
  wizardMessage,
} from "./wizard";
import { projectsWithConsoleActivity } from "./project-activity";
import { spaceRows } from "./space";

/** Stable empty state so OverseerSpace does not repeat its ranking work during boot. */
const EMPTY_SIGNALS: Signal[] = [];
const NO_HELD_RELAYS: HeldRelay[] = [];
const NO_ROWS: SpaceStatusEntry[] = [];

/**
 * Adapts discovery state into the values rendered by the application shell.
 * The wizard remains the source of truth; this hook only derives presentation.
 */
export function useShellPresentation(
  wizard: DiscoveryController,
  consoles: ConsoleInfo[] = [],
  heldRelays: HeldRelay[] = NO_HELD_RELAYS,
) {
  const furniture = furnitureFor(wizard);
  const projects = useMemo(
    () => projectsWithConsoleActivity(projectsFor(wizard), consoles),
    [wizard, consoles],
  );
  const activeProject: Project | undefined =
    projects.find((project) => project.path === wizard.activeProjectPath) ??
    (furniture.activeProject ? projects[0] : undefined);

  const provider: ProviderInfo = useMemo(() => {
    const reported = wizard.providers.find(
      (candidate) => candidate.id === wizard.attachedProviderId,
    );
    return {
      name: reported?.id ?? "",
      version: reported?.status.version ?? "",
      authenticated: reported?.status.authenticated ?? false,
      reachable: reported?.status.reachable,
      detail: reported?.status.detail,
      authExpired: reported?.authExpired === true,
      usage: reported?.status.usage ?? [],
      usageState: reported?.status.usageState,
      usageCheck: reported?.usageCheck === true,
      spend: "",
      context: "",
    };
  }, [wizard.providers, wizard.attachedProviderId]);

  const workspace = useMemo(
    () => ({ root: wizard.workspaceRoot ?? "" }),
    [wizard.workspaceRoot],
  );

  const signals = useMemo(
    () =>
      deriveSignals({
        projects,
        activeProject,
        consoles,
        provider,
        rejected: wizard.rejected,
        untrackedFolders: wizard.untrackedFolders,
        personalityMissing: wizard.personalityMissing,
        personalityRescued: wizard.personalityRescued,
        personalityRescueMessage: wizard.personalityRescueMessage,
        heldRelays,
      }),
    [
      heldRelays,
      projects,
      activeProject,
      consoles,
      provider,
      wizard.rejected,
      wizard.untrackedFolders,
      wizard.personalityMissing,
      wizard.personalityRescued,
      wizard.personalityRescueMessage,
    ],
  );

  const askingName = welcomeNeedsName(wizard);
  const pickingTone = welcomeNeedsTone(wizard);
  const wizardWord = wizardMessage(wizard);

  /**
   * What the message surface says, in priority order.
   *
   * A socket error outranks everything — nothing below it is knowable. The
   * wizard owns the line while it is driving. Then the server's own last word,
   * if it spoke more recently than the world changed. Otherwise the ranked
   * signal list decides, which is the steady state.
   *
   * Only the words are chosen here; `activity` travels separately and is what
   * the status light beside the line reads. That split is what lets the
   * message be a sentence in the operator's tone without losing the severity
   * the uppercase word used to carry (spec/behaviour/overseer.md §2.1).
   */
  const derived = messageFor(signals);
  const tone = wizard.personality.tone;
  const message = wizard.error
    ? { text: wizard.error, activity: "attention" as const }
    : wizardWord
      ? { text: wizardWord, activity: "working" as const }
      : askingName
        ? { text: "", activity: "working" as const }
        : wizard.space.message !== undefined
          ? {
              text: [
                toneMessage(
                  tone,
                  wizard.space.message.key,
                  wizard.space.message.vars,
                ),
                wizard.space.message.verbatim,
              ]
                .filter(Boolean)
                .join(" · "),
              activity: wizard.space.message.activity,
            }
          : {
            // A signal's own override is verbatim — alarm words are not for a
            // tone pack to soften.
            text: derived.text ?? toneMessage(tone, derived.key),
            activity: derived.activity,
          };
  const typingChance = wizard.error
    ? 0
    : wizard.reset || wizard.forceMessageType || wizardWord
      ? 1
      : wizard.personality.typingChance;

  // Keep the caret after the goodbye types out — the hold is the last thing
  // the operator sees, and a line with no caret reads as finished rather than
  // waiting. A click on the message restarts without sitting out the full hold.
  const holdCaret = wizard.reset === "goodbye";
  const onGoodbyeClick =
    wizard.reset === "goodbye" ? () => location.reload() : undefined;

  // The status rows belong to the pass that wrote them: none behind the
  // name and tone asks, and none past the goodbye — that is a message and
  // nothing else (spec/behaviour/overseer.md §3).
  const statusRows = useMemo(
    () =>
      wizard.reset !== "goodbye" &&
      (wizard.phase === "discovery" ||
        wizard.phase === "settling" ||
        wizard.phase === "ready")
        ? spaceRows(wizard.space)
        : NO_ROWS,
    [wizard.phase, wizard.reset, wizard.space],
  );

  return {
    furniture,
    projects,
    activeProject,
    provider,
    workspace,
    signals: furniture.signals ? signals : EMPTY_SIGNALS,
    statusRows,
    message,
    loading: isLoading(wizard),
    typingChance,
    holdCaret,
    onGoodbyeClick,
    askingName,
    pickingTone,
    namePrefix: nameAskPrefix(wizard),
  };
}
