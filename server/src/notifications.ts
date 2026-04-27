import type { AppConfig } from "./types";
import type { Database } from "./db";

export async function emitEvent(db: Database, config: AppConfig, userId: string, email: string, event: string, fallback: string) {
  if (config.notifications?.enabled === false) return;
  const rule = config.notifications?.rules?.find((item) => item.event === event);
  const message = rule?.message || fallback;
  await db.addNotification(userId, event, message);
  if (rule?.email) {
    await db.addEmail(userId, email, `ConfigForge: ${message}`, `Mock transactional email for event "${event}".`);
  }
}
