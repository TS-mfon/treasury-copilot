import assert from "node:assert/strict";
import test from "node:test";
import { shouldBlockSetupNavigation } from "../src/lib/ownerAccess";

const owner = "0xEd9EDd8586b20524CafA4F568413C504C9B03172";

test("connected wallets without an owner session are stopped before Setup navigation", () => {
  assert.equal(shouldBlockSetupNavigation({
    walletConnected: true,
    sessionAuthenticated: false,
    sessionOwner: null,
    walletAddress: owner,
  }), true);
});

test("a session for another wallet does not unlock Setup", () => {
  assert.equal(shouldBlockSetupNavigation({
    walletConnected: true,
    sessionAuthenticated: true,
    sessionOwner: "0x5905c9Dea6Ae52AA0947D8F7F218263889eDfC4E",
    walletAddress: owner,
  }), true);
});

test("the matching authenticated owner can navigate to Setup", () => {
  assert.equal(shouldBlockSetupNavigation({
    walletConnected: true,
    sessionAuthenticated: true,
    sessionOwner: owner.toLowerCase(),
    walletAddress: owner,
  }), false);
});

test("disconnected navigation keeps the existing route behavior", () => {
  assert.equal(shouldBlockSetupNavigation({
    walletConnected: false,
    sessionAuthenticated: false,
    sessionOwner: null,
    walletAddress: null,
  }), false);
});
