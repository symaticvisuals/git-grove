import { realServiceHost } from "../core/service/service-host.js";
import { createServiceManager } from "../core/service/service-manager.js";
import { binPath } from "./bin-path.js";
import type { UiDeps } from "./commands/ui.js";
import { openUrl } from "./open-url.js";
import { serveForeground } from "./serve-foreground.js";

/** `ui` and `service` as they run for real: this machine's launchd or systemd, its browser, this CLI's bin. */
export function realUiDeps(): UiDeps {
  return {
    service: createServiceManager(realServiceHost()),
    openUrl: (url) => openUrl(url),
    serveForeground,
    bin: binPath(),
  };
}
