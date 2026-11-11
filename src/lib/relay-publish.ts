import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "../types";

export const PUBLISH_TIMEOUT_MS = 10_000;
type PublishPool = Pick<RelayPool, "publish">;
type Response = Awaited<ReturnType<PublishPool["publish"]>>[number];

/** Results are a snapshot at first acceptance, or after every attempt fails.
 * Each relay keeps its own bounded Applesauce publish/retry running after success.
 * Signing belongs to the caller: every attempt sends the exact same event.
 */
export function publishUntilAccepted(pool: PublishPool, relays: string[], event: NostrEvent, timeoutMs = PUBLISH_TIMEOUT_MS): Promise<Response[]> {
  const targets = [...new Set(relays)];
  if (!targets.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    const results: Response[] = [];
    let remaining = targets.length;
    let settled = false;
    for (const relay of targets) {
      let finished = false;
      const finish = (response: Response) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        results.push(response);
        remaining--;
        if (!settled && (response.ok || remaining === 0)) {
          settled = true;
          resolve([...results]);
        }
      };
      const timer = setTimeout(() => finish({ from: relay, ok: false, message: "Relay acknowledgement timed out" }), timeoutMs);
      // Start all attempts before processing any result, including synchronous errors.
      Promise.resolve().then(() => pool.publish([relay], event, { timeout: timeoutMs })).then(
        (responses) => finish(responses.find(({ ok }) => ok) ?? responses[0] ?? { from: relay, ok: false, message: "Relay returned no acknowledgement" }),
        (error: unknown) => finish({ from: relay, ok: false, message: error instanceof Error ? error.message : "Relay publish failed" }),
      );
    }
  });
}
