import { describe, expect, it } from "vitest";
import { _internal } from "./discord-rpc.ts";

describe("Discord local RPC capability gate", () => {
  it("requires both rpc and messages.read scopes", () => {
    expect(() => _internal.rpcCredentials({ discordAccount: { clientId: "app", accessToken: "token", scope: "identify guilds" } })).toThrow(/messages.read/);
  });

  it("accepts the read-only channel research scopes", () => {
    expect(_internal.rpcCredentials({ discordAccount: { clientId: "app", accessToken: "token", scope: "identify guilds rpc messages.read" } })).toEqual({ clientId: "app", accessToken: "token" });
  });
});
