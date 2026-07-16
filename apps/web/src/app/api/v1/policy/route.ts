import { isAddress, verifyMessage, type Address } from "viem";
import { bearerToken, verifyAgentApiKey } from "@/lib/apiAuth";
import { assertPolicyMatchesApiKey, assertRegistryBinding, amountToUnits, readPolicyState } from "@/lib/apiServer";
import { genlayerWrite } from "@/lib/genlayerServer";

export const runtime = "nodejs";

function parseUpdate(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid policy update payload");
  const body = value as Record<string, unknown>;
  return {
    authorizedAgent: body.authorized_agent,
    executionReporter: body.execution_reporter,
    perTxCap: body.per_tx_cap,
    weeklyCap: body.weekly_cap,
    autoApproveThreshold: body.auto_approve_threshold,
    policyText: body.policy_text,
    ownerSignature: body.owner_signature,
    ownerMessage: body.owner_message,
  };
}

export async function GET(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const policy = await readPolicyState(claims.policy);
    assertPolicyMatchesApiKey(policy, claims);
    await assertRegistryBinding(claims);
    return Response.json({ policy: claims.policy, state: policy });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Policy request failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const claims = verifyAgentApiKey(bearerToken(request));
    const current = await readPolicyState(claims.policy);
    assertPolicyMatchesApiKey(current, claims);
    await assertRegistryBinding(claims);
    const body = parseUpdate(await request.json());
    if (typeof body.ownerMessage !== "string" || !body.ownerMessage.includes("Treasury Copilot policy update")) {
      throw new Error("Owner authorization message is required");
    }
    if (typeof body.ownerSignature !== "string") throw new Error("Owner signature is required");
    const ownerAuthorized = await verifyMessage({
      address: claims.owner,
      message: body.ownerMessage,
      signature: body.ownerSignature as `0x${string}`,
    });
    if (!ownerAuthorized) throw new Error("Owner signature is invalid");
    const authorizedAgent = typeof body.authorizedAgent === "string" && isAddress(body.authorizedAgent)
      ? body.authorizedAgent as Address
      : claims.agent;
    const executionReporter = typeof body.executionReporter === "string" && isAddress(body.executionReporter)
      ? body.executionReporter as Address
      : (current.execution_reporter as Address);
    if (!isAddress(executionReporter)) throw new Error("Invalid execution reporter");
    if (typeof body.policyText !== "string" || body.policyText.trim().length < 8) throw new Error("Policy text is too short");
    const perTx = amountToUnits(String(body.perTxCap ?? "0"), claims.tokenDecimals);
    const weekly = amountToUnits(String(body.weeklyCap ?? "0"), claims.tokenDecimals);
    const threshold = amountToUnits(String(body.autoApproveThreshold ?? "0"), claims.tokenDecimals);
    const write = await genlayerWrite(claims.policy, "update_policy", [
      authorizedAgent,
      executionReporter,
      perTx.toString(),
      weekly.toString(),
      threshold.toString(),
      body.policyText.trim(),
    ]);
    const state = await readPolicyState(claims.policy);
    return Response.json({ updated: true, write, state });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Policy update failed" }, { status: 400 });
  }
}
