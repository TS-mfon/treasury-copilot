import assert from "node:assert/strict";
import test from "node:test";
import { assertGenLayerExecutionSucceeded } from "../src/lib/genlayerServer";

test("finalized GenLayer receipts still fail closed on contract execution errors", () => {
  assert.throws(() => assertGenLayerExecutionSucceeded({
    status_name: "FINALIZED",
    result_name: "MAJORITY_AGREE",
    consensus_data: {
      leader_receipt: [{
        execution_result: "ERROR",
        mode: "leader",
        genvm_result: { stderr: "AttributeError: invalid address value" },
        result: { status: "contract_error" },
      }],
    },
  }, "Treasury policy deployment"), /failed on GenLayer/);
});

test("successful finalized GenLayer receipts pass execution validation", () => {
  assert.doesNotThrow(() => assertGenLayerExecutionSucceeded({
    status_name: "FINALIZED",
    result_name: "MAJORITY_AGREE",
    consensus_data: {
      leader_receipt: [{
        execution_result: "SUCCESS",
        mode: "leader",
        result: { status: "return" },
      }, {
        execution_result: "ERROR",
        mode: "validator",
        vote: "idle",
        genvm_result: {
          error_code: "CONSENSUS_VALIDATOR_QUORUM_REACHED",
          stderr: "Validator execution cancelled after quorum",
        },
      }],
    },
  }, "register_delegation"));
});
