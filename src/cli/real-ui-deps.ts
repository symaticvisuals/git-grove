import { homedir } from "node:os";
import { claudeSettingsPath } from "../core/guard-install/claude-settings-path.js";
import { guardHookCommand } from "../core/guard-install/guard-hook-command.js";
import { guardPhaseOf } from "../core/guard-install/guard-phase-of.js";
import { readGuardStatus } from "../core/guard-install/read-guard-status.js";
import { readSettingsFile } from "../core/guard-install/read-settings-file.js";
import { isEphemeralBin } from "../core/is-ephemeral-bin.js";
import { realServiceHost } from "../core/service/service-host.js";
import { createServiceManager } from "../core/service/service-manager.js";
import { binPath } from "./bin-path.js";
import type { UiDeps } from "./commands/ui.js";
import { openUrl } from "./open-url.js";
import { serveForeground } from "./serve-foreground.js";
import { stableNodePath } from "./stable-node-path.js";

/** `ui` and `service` as they run for real: this machine's launchd or systemd, its browser, this CLI's bin, and this user's Claude Code settings, which it only reads. */
export function realUiDeps(): UiDeps {
  const settingsPath = claudeSettingsPath(process.env, homedir());
  return {
    service: createServiceManager(realServiceHost()),
    openUrl: (url) => openUrl(url),
    serveForeground,
    bin: binPath(),
    claudeSettingsPath: settingsPath,
    guardDone: async () => {
      const file = await readSettingsFile(settingsPath);
      const reading = readGuardStatus(file.text, guardHookCommand(stableNodePath(), binPath()), file.problem);
      return guardPhaseOf({ reading, hookCommand: !isEphemeralBin(binPath()) }).done;
    },
  };
}
