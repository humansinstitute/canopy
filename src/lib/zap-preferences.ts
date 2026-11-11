import { changeSetting, readSetting } from "./settings-state";
export interface ZapPreferences {
  amount: number;
  message: string;
}

export const DEFAULT_ZAP_PREFERENCES: Readonly<ZapPreferences> = Object.freeze({ amount: 21, message: "" });
export const MAX_ZAP_MESSAGE_LENGTH = 280;

const storageKey = (pubkey: string) => `canopy.zapPreferences.${pubkey}`;

export function validateZapPreferences(amount: number, message: string): ZapPreferences {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw new Error("Choose a whole default zap amount from 1 to 1,000,000 sats.");
  }
  if (typeof message !== "string") throw new Error("The default zap message must be text.");
  if (message.length > MAX_ZAP_MESSAGE_LENGTH) {
    throw new Error(`Keep the default zap message to ${MAX_ZAP_MESSAGE_LENGTH} characters or fewer.`);
  }
  return { amount, message };
}

export function loadZapPreferences(pubkey: string): ZapPreferences {
  try {
    const saved = readSetting(pubkey, "zap");
    const value: unknown = saved ? saved.value : JSON.parse(localStorage.getItem(storageKey(pubkey)) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_ZAP_PREFERENCES };
    const stored = value as Record<string, unknown>;
    return validateZapPreferences(stored.amount as number, stored.message as string);
  } catch {
    return { ...DEFAULT_ZAP_PREFERENCES };
  }
}

export function saveZapPreferences(pubkey: string, preferences: ZapPreferences): ZapPreferences {
  const validated = validateZapPreferences(preferences.amount, preferences.message);
  changeSetting(pubkey, "zap", validated);
  try {
    localStorage.setItem(storageKey(pubkey), JSON.stringify(validated));
  } catch {
    // Browser privacy settings or storage quotas must not prevent zapping this session.
  }
  return validated;
}
