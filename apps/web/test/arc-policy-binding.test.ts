import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { assertPolicyMatchesApiKey, type PolicyState } from "../src/lib/apiServer";
import type { AgentApiKeyClaims } from "../src/lib/apiAuth";

const PLATFORM_KEY = `0x${"ab".repeat(32)}` as Hex;
const PLATFORM = privateKeyToAccount(PLATFORM_KEY).address;

const ARC_TESTNET = 5042002;
const BASE_SEPOLIA = 84532;

const owner: Address = "0x1111111111111111111111111111111111111111";
const agent: Address = "0x2222222222222222222222222222222222222222";
const policyAddress: Address = "0x3333333333333333333333333333333333333333";
const vault: Address = "0xb121b87cf9e30293eb619b7ebc0554dfd3018cc2";
const arcUsdc: Address = "0x3600000000000000000000000000000000000000";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function claims(overrides: Partial<AgentApiKeyClaims> = {}): AgentApiKeyClaims {
  return {
    type: "agent",
    version: 1,
    keyId: "key-1",
    keyVersion: 1,
    owner,
    agent,
    policy: policyAddress,
    delegatedAccount: vault,
    chainId: ARC_TESTNET,
    token: arcUsdc,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    issuedAt: 0,
    ...overrides,
  };
}

/** A V6 Arc policy whose every pre-vault check already passes. */
function arcPolicy(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    contract_version: "6",
    owner,
    authorized_agent: agent,
    execution_reporter: PLATFORM,
    delegated_account: vault,
    token_address: arcUsdc,
    evm_chain_id: String(ARC_TESTNET),
    auto_approve_threshold_atto: "0",
    settlement_backend: "arc-vault",
    vault_address: vault,
    vault_registered: true,
    ...overrides,
  };
}

const ARC_ON = { AGENT_SIGNER_PRIVATE_KEY: PLATFORM_KEY, ARC_SETTLEMENT_ENABLED: "true" };

test("a V6 Arc policy with a registered vault is accepted without any delegation", () => {
  withEnv(ARC_ON, () => {
    // Deliberately no delegation_registered or delegation_payload: Arc has no ERC-7715 delegation.
    assert.doesNotThrow(() => assertPolicyMatchesApiKey(arcPolicy(), claims()));
  });
});

test("a V6 Arc policy whose vault is not registered is rejected", () => {
  withEnv(ARC_ON, () => {
    assert.throws(
      () => assertPolicyMatchesApiKey(arcPolicy({ vault_registered: false }), claims()),
      /register the agent treasury vault/,
    );
  });
});

test("an Arc policy with no vault address at all is rejected", () => {
  withEnv(ARC_ON, () => {
    assert.throws(
      () => assertPolicyMatchesApiKey(
        arcPolicy({ vault_address: "", delegated_account: "" }),
        claims({ delegatedAccount: "" as Address }),
      ),
      /No agent treasury vault is registered/,
    );
  });
});

test("Arc is refused entirely when the settlement kill switch is off", () => {
  withEnv({ AGENT_SIGNER_PRIVATE_KEY: PLATFORM_KEY, ARC_SETTLEMENT_ENABLED: undefined }, () => {
    assert.throws(
      () => assertPolicyMatchesApiKey(arcPolicy(), claims()),
      /Arc settlement is disabled/,
    );
  });
});

test("a Base Sepolia policy still requires a registered ERC-7715 delegation", () => {
  withEnv(ARC_ON, () => {
    const basePolicy: PolicyState = {
      contract_version: "6",
      owner,
      authorized_agent: agent,
      execution_reporter: PLATFORM,
      delegated_account: vault,
      token_address: arcUsdc,
      evm_chain_id: String(BASE_SEPOLIA),
      auto_approve_threshold_atto: "0",
      settlement_backend: "delegated-7710",
    };
    const baseClaims = claims({ chainId: BASE_SEPOLIA });

    // A registered vault must not substitute for a delegation on a delegation-settled chain.
    assert.throws(
      () => assertPolicyMatchesApiKey({ ...basePolicy, vault_registered: true }, baseClaims),
      /Delegation is not registered/,
    );
    assert.doesNotThrow(() =>
      assertPolicyMatchesApiKey(
        { ...basePolicy, delegation_registered: true, delegation_payload: "{}" },
        baseClaims,
      ),
    );
  });
});

test("a pre-V6 Arc-shaped policy is accepted on its registry-pinned funding account", () => {
  withEnv(ARC_ON, () => {
    // V5 has no vault_address; the vault lives in delegated_account, which the registry pinned.
    const legacy = arcPolicy({
      contract_version: "5",
      vault_address: undefined,
      vault_registered: undefined,
    });
    assert.doesNotThrow(() => assertPolicyMatchesApiKey(legacy, claims()));
  });
});

test("the earlier binding checks still run before the vault branch is reached", () => {
  withEnv(ARC_ON, () => {
    assert.throws(
      () => assertPolicyMatchesApiKey(arcPolicy({ contract_version: "3" }), claims()),
      /Policy migration required/,
    );
    assert.throws(
      () => assertPolicyMatchesApiKey(arcPolicy({ auto_approve_threshold_atto: "1" }), claims()),
      /fast approval must be disabled/,
    );
    assert.throws(
      () => assertPolicyMatchesApiKey(
        arcPolicy({ authorized_agent: "0x9999999999999999999999999999999999999999" }),
        claims(),
      ),
      /agent is not authorized/,
    );
    assert.throws(
      () => assertPolicyMatchesApiKey(arcPolicy({ evm_chain_id: "999" }), claims()),
      /chain does not match/,
    );
    assert.throws(
      () => assertPolicyMatchesApiKey(
        arcPolicy({ execution_reporter: "0x9999999999999999999999999999999999999999" }),
        claims(),
      ),
      /execution reporter/,
    );
  });
});
