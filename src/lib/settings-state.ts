import { Subject } from "rxjs";

export type SettingName = "network" | "nwc" | "zap";
export const settingNames: SettingName[] = ["network", "nwc", "zap"];
export interface SettingRegister { clock: number; writer: string; value: unknown }
export interface SettingsState {
  schema: 1;
  pubkey: string;
  fields: Partial<Record<SettingName, SettingRegister>>;
}
export const settingsChanges$ = new Subject<string>();
const key = (pubkey: string) => `canopy.settings.v1.${pubkey}`;

/** One atomic local record is authoritative; legacy keys remain readable for migration. */
export function readSettingsState(pubkey: string): SettingsState {
  const raw = localStorage.getItem(key(pubkey));
  if (!raw) return { schema: 1, pubkey, fields: {} };
  const state = JSON.parse(raw) as SettingsState;
  if (state.schema !== 1 || state.pubkey !== pubkey || !state.fields || typeof state.fields !== "object") throw new Error("Local settings need recovery; no backup was overwritten.");
  return state;
}

export function readSetting(pubkey: string, name: SettingName): SettingRegister | undefined {
  return readSettingsState(pubkey).fields[name];
}

export function writeSettingsState(state: SettingsState): void {
  localStorage.setItem(key(state.pubkey), JSON.stringify(state));
}

export function changeSetting(pubkey: string, name: SettingName, value: unknown): void {
  changeSettings(pubkey, { [name]: value });
}

export function changeSettings(pubkey: string, values: Partial<Record<SettingName, unknown>>): void {
  const state = readSettingsState(pubkey);
  const names = settingNames.filter(name => Object.prototype.hasOwnProperty.call(values, name) && JSON.stringify(state.fields[name]?.value) !== JSON.stringify(values[name]));
  if (!names.length) return;
  const clock = Math.max(0, ...Object.values(state.fields).map((field) => field?.clock ?? 0)) + 1;
  const writer = crypto.randomUUID();
  for (const name of names) state.fields[name] = { clock, writer, value: values[name] };
  writeSettingsState(state);
  settingsChanges$.next(pubkey);
}

export function compareRegisters(a: SettingRegister, b: SettingRegister): number {
  // Explicit removal wins equal-clock concurrent edits. Other same-field ties are deterministic.
  return a.clock - b.clock || Number(a.value === null) - Number(b.value === null) || a.writer.localeCompare(b.writer) || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value));
}

export function mergeSettings(a: SettingsState, b: SettingsState): SettingsState {
  if (a.pubkey !== b.pubkey) throw new Error("Settings account mismatch.");
  const fields = { ...a.fields };
  for (const name of settingNames) {
    const incoming = b.fields[name];
    if (incoming && (!fields[name] || compareRegisters(incoming, fields[name]) > 0)) fields[name] = incoming;
  }
  return { schema: 1, pubkey: a.pubkey, fields };
}
