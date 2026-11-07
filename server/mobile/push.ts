// Push to paired phones. Sends only when this server has its own APNs or FCM credentials; without them every send is
// "skipped", and the phone still hears everything over the event stream while it is open.
import type { PushService } from "../../shared/mobile-link.ts";

/** What a push carries: never a message body, so a lock screen shows who wrote, not what. */
export interface PushMessage {
  id: string;
  kind: string;
  title: string;
  botId: string;
  botName: string;
  threadId: string;
  groupId?: string;
}

export interface PushTarget {
  service: PushService;
  token: string;
  environment?: "sandbox" | "production";
}

/** `gone`: the service says the token is dead, so the phone's registration is dropped. */
export type PushOutcome = "sent" | "gone" | "failed" | "skipped";

export interface PushSender {
  configured: readonly PushService[];
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

export function createPushSender(): PushSender {
  return { configured: [], send: async () => "skipped" };
}
