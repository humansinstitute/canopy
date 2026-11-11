import { beforeEach, describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";
import {
  clearNStackDestination,
  discoverNStackInventory,
  getNStackProvider,
  loadNStackDestination,
  nstackAvailable,
  parseNStacks,
  parseNStackWorkspaces,
  resolveNStackDestination,
  saveNStackDestination,
  waitForNStackProvider,
  type NStackDestination,
} from "../src/lib/nstack";
import type { NStackProvider } from "../src/types";

const owner = nip19.npubEncode("11".repeat(32));
const workspaceService = nip19.npubEncode("22".repeat(32));
const service = nip19.npubEncode("33".repeat(32));
const destination: NStackDestination = {
  serverUrl: "https://tower.example/base",
  workspaceId: "real-workspace-id",
  workspaceName: "Wingman Suite",
  workspaceOwnerNpub: owner,
  workspaceServiceNpub: workspaceService,
  serviceNpub: service,
};

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    id: "opaque-workspace-alias",
    name: "Wingman Suite",
    description: "Chat, tasks and files",
    directHttpsUrl: "https://tower.example/base/",
    workspaceId: "real-workspace-id",
    workspaceOwnerNpub: owner,
    workspaceServiceNpub: workspaceService,
    serviceNpub: service,
    ...overrides,
    token: "must-not-copy",
    credential: "must-not-copy",
  };
}

function provider(methods: Partial<NStackProvider> = {}): NStackProvider {
  return {
    version: 1,
    isAvailable: async () => ({ available: true, version: 1 }),
    requestDiscovery: async () => ({ approved: true }),
    listNStacks: async () => [],
    listWorkspaces: async () => [],
    getConnection: async () => ({}),
    on: () => undefined,
    ...methods,
  };
}

describe("NStack connection autofill", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    delete window.NStack;
    delete window.NStackReady;
    vi.useRealTimers();
  });

  it("feature-detects the autofill surface without capabilities or a pinned version", () => {
    expect(getNStackProvider()).toBeUndefined();
    window.NStack = { version: 1, isAvailable: () => true } as never;
    expect(getNStackProvider()).toBeUndefined();
    window.NStack = provider();
    expect(getNStackProvider()).toBe(window.NStack);
    window.NStack = { ...provider(), version: "connection-autofill" };
    expect(getNStackProvider()).toBe(window.NStack);
    const { version: _version, ...unversioned } = provider();
    window.NStack = unversioned;
    expect(getNStackProvider()).toBe(window.NStack);
    expect(nstackAvailable(false)).toBe(false);
    expect(nstackAvailable({ available: true, version: 1 })).toBe(true);
  });

  it("finds a provider injected after startup with a bounded retry", async () => {
    vi.useFakeTimers();
    const pending = waitForNStackProvider({ timeoutMs: 500, intervalMs: 25 });
    window.NStack = provider();
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBe(window.NStack);

    delete window.NStack;
    const absent = waitForNStackProvider({ timeoutMs: 100, intervalMs: 25 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(absent).resolves.toBeUndefined();
  });

  it("waits for the v1 NStackReady bootstrap instead of racing its queued provider", async () => {
    vi.useFakeTimers();
    let markReady!: (value: NStackProvider) => void;
    window.NStackReady = new Promise((resolve) => { markReady = resolve; });
    const pending = waitForNStackProvider({ timeoutMs: 500, intervalMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const finalProvider = provider();
    window.NStack = finalProvider;
    markReady(finalProvider);
    await expect(pending).resolves.toBe(finalProvider);
  });

  it("waits through NBrowser's document-start stub until the page bridge replaces it", async () => {
    vi.useFakeTimers();
    let install!: (api: NStackProvider) => void;
    const ready = new Promise<NStackProvider>((resolve) => { install = (api) => { window.NStack = api; resolve(api); }; });
    const queued = () => ready.then(() => undefined);
    window.NStackReady = ready;
    window.NStack = Object.freeze({ ...provider({ isAvailable: queued, requestDiscovery: queued, listNStacks: queued, listWorkspaces: queued, getConnection: queued }), ready });
    const stub = window.NStack;

    const pending = waitForNStackProvider({ timeoutMs: 3_000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1_500);
    const bridge = Object.freeze({ ...provider(), ready: Promise.resolve() });
    install(bridge);
    await vi.advanceTimersByTimeAsync(0);
    const detected = await pending;
    expect(detected).toBe(bridge);
    expect(detected).not.toBe(stub);
    const alreadyInstalled = waitForNStackProvider({ timeoutMs: 3_000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(alreadyInstalled).resolves.toBe(bridge);

    delete window.NStack;
    delete window.NStackReady;
    window.NStack = Object.freeze({ ...provider(), ready: new Promise(() => undefined) });
    const neverInstalled = waitForNStackProvider({ timeoutMs: 3_000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(neverInstalled).resolves.toBeUndefined();
  });

  it("requests consent before any list call and returns multiple disclosed workspaces", async () => {
    const calls: string[] = [];
    const bridge = provider({
      requestDiscovery: async (options) => { calls.push(`discover:${options.workspaces}`); return { approved: true }; },
      listNStacks: async () => { calls.push("stacks"); return [
        { id: "opaque-personal", name: "Personal" },
        { id: "opaque-studio", name: "Studio" },
      ]; },
      listWorkspaces: async ({ stackId }) => { calls.push(`workspaces:${stackId}`); return [descriptor({ workspaceId: stackId === "opaque-personal" ? "personal-real" : "studio-real" })]; },
    });

    const result = await discoverNStackInventory(bridge);
    expect(calls).toEqual(["discover:true", "stacks", "workspaces:opaque-personal", "workspaces:opaque-studio"]);
    expect(result.stacks).toHaveLength(2);
    expect(result.workspaces.map(({ destination }) => destination.workspaceId)).toEqual(["personal-real", "studio-real"]);
  });

  it("copies only canonical safe descriptor fields and never opaque aliases or credentials", () => {
    expect(parseNStacks({ stacks: [
      { id: "opaque-personal", name: "Pete’s NStack", status: "online", credential: "secret" },
      { id: "opaque-personal", name: "duplicate" },
    ] })).toEqual([{ id: "opaque-personal", name: "Pete’s NStack", status: "online", description: undefined }]);

    expect(parseNStackWorkspaces({ workspaces: [descriptor()] }, "opaque-personal")).toEqual([{
      id: "opaque-workspace-alias",
      stackId: "opaque-personal",
      name: "Wingman Suite",
      description: "Chat, tasks and files",
      destination,
    }]);
  });

  it("imports NBrowser's workspace descriptor shape without copying its nested alias", () => {
    const [workspace] = parseNStackWorkspaces([{
      id: "opaque-workspace-alias",
      name: "Pete",
      workspaceId: "real-workspace-id",
      workspaceOwnerNpub: owner,
      workspaceServiceNpub: workspaceService,
      directHttpsUrl: "https://tower.example",
      nstack: { id: "opaque-stack-alias", name: "tower.example", url: "https://tower.example" },
    }], "opaque-stack-alias");
    expect(workspace?.destination).toEqual({ serverUrl: "https://tower.example", workspaceId: "real-workspace-id", workspaceName: "Pete", workspaceOwnerNpub: owner, workspaceServiceNpub: workspaceService });
    expect(JSON.stringify(workspace?.destination)).not.toContain("opaque");
  });

  it("revalidates the selected alias before importing the real destination", async () => {
    const workspace = parseNStackWorkspaces([descriptor()], "opaque-personal")[0]!;
    const getConnection = vi.fn(async () => descriptor());
    await expect(resolveNStackDestination(provider({ getConnection }), workspace)).resolves.toEqual(destination);
    expect(getConnection).toHaveBeenCalledWith({ stackId: "opaque-personal", workspaceId: "opaque-workspace-alias" });
    await expect(resolveNStackDestination(provider({ getConnection: async () => descriptor({ directHttpsUrl: "http://unsafe.example" }) }), workspace)).rejects.toThrow("unsafe or changed");
  });

  it("rejects malformed, unsafe, incomplete and credential-shaped descriptors", () => {
    expect(parseNStackWorkspaces({ workspaces: [
      descriptor({ directHttpsUrl: "http://tower.example" }),
      descriptor({ directHttpsUrl: "https://user:pass@tower.example" }),
      descriptor({ workspaceId: "" }),
      descriptor({ workspaceOwnerNpub: "npub1bad" }),
      { ...descriptor(), directHttpsUrl: undefined },
      { ...descriptor(), id: "alias\ncontrol" },
    ] }, "stack")).toEqual([]);
  });

  it("persists only validated real connection metadata and clears it on revoke", () => {
    values.set("canopy.networkSettings.owner", JSON.stringify({ read: ["wss://read.example"], write: ["wss://write.example"], blossom: ["https://blossom.example"] }));
    saveNStackDestination("owner", destination);
    expect(loadNStackDestination("owner")).toEqual(destination);
    const stored = values.get("canopy.networkSettings.owner") || "";
    expect(stored).not.toContain("opaque");
    expect(stored).not.toContain("token");
    expect(stored).not.toContain("credential");
    clearNStackDestination("owner");
    expect(loadNStackDestination("owner")).toBeUndefined();
    expect(JSON.parse(values.get("canopy.networkSettings.owner") || "null")).toEqual({ read: ["wss://read.example"], write: ["wss://write.example"], blossom: ["https://blossom.example"] });
    expect(() => saveNStackDestination("owner", { ...destination, serverUrl: "http://unsafe.example" })).toThrow("unsafe or incomplete");
  });

  it("fails closed when persisted connection data is malformed", () => {
    values.set("canopy.nstackDestination.owner", JSON.stringify({ ...destination, serverUrl: "javascript:alert(1)" }));
    expect(loadNStackDestination("owner")).toBeUndefined();
    values.set("canopy.nstackDestination.owner", "not-json");
    expect(loadNStackDestination("owner")).toBeUndefined();
  });
});
