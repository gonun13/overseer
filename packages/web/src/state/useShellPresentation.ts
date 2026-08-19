import { useEffect, useMemo } from "react";
import type { Project, ProviderInfo, Session } from "../domain";
import type { WindowKind } from "../windows";
import { deriveSignals, headlineFor, type Signal } from "./signals";
import type { DiscoveryController } from "./useDiscovery";
import {
  furnitureFor,
  isLoading,
  nameAskPrefix,
  projectsFor,
  welcomeNeedsName,
  welcomeNeedsTone,
  wizardHeadline,
} from "./wizard";
import { projectsWithSessionActivity } from "./project-activity";

/** Stable empty state so OverseerSpace does not repeat its ranking work during boot. */
const EMPTY_SIGNALS: Signal[] = [];

type OpenWindow = (
  kind: WindowKind,
  payload?: unknown,
  title?: string,
) => void;

/**
 * Adapts discovery state into the values rendered by the application shell.
 * The wizard remains the source of truth; this hook only derives presentation.
 */
export function useShellPresentation(
  wizard: DiscoveryController,
  openWindow: OpenWindow,
  sessions: Session[] = [],
) {
  const furniture = furnitureFor(wizard);
  const projects = useMemo(
    () => projectsWithSessionActivity(projectsFor(wizard), sessions),
    [wizard, sessions],
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
        sessions,
        approvals: [],
        capabilities: [],
        provider,
        rejected: wizard.rejected,
        untrackedFolders: wizard.untrackedFolders,
        personalityMissing: wizard.personalityMissing,
        personalityRescued: wizard.personalityRescued,
        personalityRescueHeadline: wizard.personalityRescueHeadline,
      }),
    [
      projects,
      activeProject,
      sessions,
      provider,
      wizard.rejected,
      wizard.untrackedFolders,
      wizard.personalityMissing,
      wizard.personalityRescued,
      wizard.personalityRescueHeadline,
    ],
  );

  const askingName = welcomeNeedsName(wizard);
  const pickingTone = welcomeNeedsTone(wizard);
  const wizardWord = wizardHeadline(wizard);
  const derivedHeadline = headlineFor(signals);
  const headline = wizard.error
    ? { text: wizard.error, activity: "attention" as const }
    : wizardWord
      ? { text: wizardWord, activity: "working" as const }
      : askingName
        ? { text: "", activity: "working" as const }
        : derivedHeadline;
  const typingChance = wizard.error
    ? 0
    : wizard.reset || wizard.forceHeadlineType || wizardWord
      ? 1
      : wizard.personality.typingChance;

  // Keep the caret after the goodbye types out — the hold is the last thing
  // the operator sees, and a line with no caret reads as finished rather than
  // waiting. A click on the headline restarts without sitting out the full hold.
  const holdCaret = wizard.reset === "goodbye";
  const onGoodbyeClick =
    wizard.reset === "goodbye" ? () => location.reload() : undefined;

  // Discovery and each later operation summon the machine-owned window.
  useEffect(() => {
    if (wizard.phase === "discovery" && wizard.connected) {
      openWindow("overseer");
    }
  }, [wizard.phase, wizard.connected, openWindow]);

  useEffect(() => {
    if (
      wizard.phase !== "discovery" &&
      wizard.phase !== "settling" &&
      wizard.phase !== "ready"
    ) {
      return;
    }
    if (wizard.operationTick > 0) openWindow("overseer");
  }, [wizard.operationTick, wizard.phase, openWindow]);

  return {
    furniture,
    projects,
    activeProject,
    provider,
    workspace,
    signals: furniture.signals ? signals : EMPTY_SIGNALS,
    headline,
    loading: isLoading(wizard),
    typingChance,
    holdCaret,
    onGoodbyeClick,
    askingName,
    pickingTone,
    namePrefix: nameAskPrefix(wizard),
  };
}
