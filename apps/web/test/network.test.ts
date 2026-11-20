import { describe, expect, it } from "vitest";
import { networkNames } from "../src/lib/config";
import { networkLabel, wrongNetworkNotice } from "../src/screens/asset.states";

describe("network names", () => {
  it("the local dev chain is never called Fuji (wallet network name, badge, text)", () => {
    expect(networkNames("local")).toEqual({ label: "local test chain", badge: "Local test chain", walletName: "Pantado local (Anvil)" });
    expect(networkNames("fuji")).toEqual({ label: "Fuji", badge: "Fuji testnet", walletName: "Avalanche Fuji C-Chain" });
    expect(networkLabel("fuji")).toBe("Fuji");
  });
  it("the wrong-network notice explains; the screen's main button is the only Switch button", () => {
    const n = wrongNetworkNotice("fuji");
    expect(n.body).toContain("Fuji");
    expect(n).not.toHaveProperty("action");
  });
});
