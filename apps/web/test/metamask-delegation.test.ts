import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import {
  isUnsupportedExecutionPermissionsError,
  requestWeeklyUsdcDelegation,
  resolveMetaMaskProvider,
} from "../src/lib/metamaskDelegation";

const owner: Address = "0x1111111111111111111111111111111111111111";
const agent: Address = "0x2222222222222222222222222222222222222222";
const token: Address = "0x3333333333333333333333333333333333333333";
const delegate: Address = "0x4444444444444444444444444444444444444444";
const manager: Address = "0x5555555555555555555555555555555555555555";

type MockProvider = {
  isMetaMask?: boolean;
  providers?: MockProvider[];
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

async function withInjectedProvider<T>(provider: MockProvider, callback: () => Promise<T>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ethereum: provider },
  });

  try {
    return await callback();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function rpcGrant() {
  return {
    from: owner,
    to: delegate,
    chainId: "0x14a34",
    context: "0x1234",
    dependencies: [],
    delegationManager: manager,
    permission: {
      type: "erc20-token-periodic",
      data: {
        tokenAddress: token,
        periodAmount: "0x5f5e100",
        periodDuration: 604800,
        startTime: 1,
      },
      isAdjustmentAllowed: false,
    },
  };
}

test("direct ERC-7715 request succeeds without capability discovery or EIP-7702 code checks", async () => {
  const methods: string[] = [];
  const provider: MockProvider = {
    isMetaMask: true,
    async request({ method }) {
      methods.push(method);
      if (method === "web3_clientVersion") return "MetaMask/v12.0.0";
      if (method === "wallet_requestExecutionPermissions") return [rpcGrant()];
      throw new Error(`Unexpected method ${method}`);
    },
  };

  const result = await withInjectedProvider(provider, () => requestWeeklyUsdcDelegation({
    owner,
    agent,
    chainKey: "baseSepolia",
    token,
    weeklyAllowanceAtto: 100_000_000n,
    platformDelegate: delegate,
  }));

  assert.equal(result.owner, owner);
  assert.equal(result.permissionContext, "0x1234");
  assert.equal(result.weeklyAllowanceAtto, "100000000");
  assert.deepEqual(methods, ["web3_clientVersion", "wallet_requestExecutionPermissions"]);
});

test("actual wallet_requestExecutionPermissions method absence is actionable", async () => {
  const provider: MockProvider = {
    isMetaMask: true,
    async request({ method }) {
      if (method === "web3_clientVersion") return "MetaMask/v12.0.0";
      throw {
        code: -32601,
        error: { message: "wallet_requestExecutionPermissions does not have a corresponding handler" },
      };
    },
  };

  await assert.rejects(
    withInjectedProvider(provider, () => requestWeeklyUsdcDelegation({
      owner,
      agent,
      chainKey: "baseSepolia",
      token,
      weeklyAllowanceAtto: 100_000_000n,
      platformDelegate: delegate,
    })),
    /does not expose wallet_requestExecutionPermissions/,
  );
});

test("user rejection is not classified as unsupported capability", async () => {
  const rejection = { code: 4001, message: "User rejected the request." };
  assert.equal(isUnsupportedExecutionPermissionsError(rejection), false);

  const provider: MockProvider = {
    isMetaMask: true,
    async request({ method }) {
      if (method === "web3_clientVersion") return "MetaMask/v12.0.0";
      throw rejection;
    },
  };

  await assert.rejects(
    withInjectedProvider(provider, () => requestWeeklyUsdcDelegation({
      owner,
      agent,
      chainKey: "baseSepolia",
      token,
      weeklyAllowanceAtto: 100_000_000n,
      platformDelegate: delegate,
    })),
    /User rejected the request/,
  );
});

test("MetaMask is selected from a multi-provider injection", () => {
  const other: MockProvider = { request: async () => null };
  const metamask: MockProvider = { isMetaMask: true, request: async () => null };
  assert.equal(resolveMetaMaskProvider({
    providers: [other, metamask],
    request: async () => null,
  }), metamask);
});
