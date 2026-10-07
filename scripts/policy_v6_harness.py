"""Exercise TreasuryPolicy's deterministic logic outside GenVM.

GenVM is not available locally, but the destination-chain allowlist and the deterministic denial
path are ordinary Python that runs before any LLM call. This harness installs a minimal stub for
the `genlayer` module, loads the real contract source, and asserts that an unpermitted destination
is refused without ever reaching `_evaluate_with_llm`.

Prints `HARNESS_OK` only when every assertion passes.
"""

from __future__ import annotations

import hashlib
import sys
import types
from dataclasses import dataclass, field
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[1] / "contracts" / "genlayer" / "TreasuryPolicy.py"


# --- minimal genlayer stubs -------------------------------------------------------------------

class UserError(Exception):
    pass


class _Vm:
    UserError = UserError


class _Message:
    def __init__(self) -> None:
        self.sender_address = "0xreporter"
        self.contract_address = "0xpolicy"


class _NonDet:
    def __init__(self) -> None:
        self.calls = 0

    def exec_prompt(self, prompt, response_format=None):  # pragma: no cover - must not be reached
        self.calls += 1
        raise AssertionError("LLM review was reached for a deterministically denied request")


class _EqPrinciple:
    def __init__(self, nondet: _NonDet) -> None:
        self._nondet = nondet

    def prompt_comparative(self, leader_fn, principle=""):
        return leader_fn()


class _Gl:
    def __init__(self) -> None:
        self.vm = _Vm()
        self.message = _Message()
        self.message_raw = {"datetime": "2026-10-06T00:00:00Z"}
        self.nondet = _NonDet()
        self.eq_principle = _EqPrinciple(self.nondet)
        self.Contract = object
        self.public = types.SimpleNamespace(
            write=lambda fn: fn,
            view=lambda fn: fn,
        )
        self._registry_binding = {}

    def get_contract_at(self, _address):
        binding = self._registry_binding

        class _View:
            def get_policy(self, _policy):
                return binding

        class _Handle:
            def view(self):
                return _View()

        return _Handle()


def install_stubs(gl: _Gl) -> None:
    module = types.ModuleType("genlayer")
    module.gl = gl
    module.u256 = int
    module.Address = lambda value: value
    module.TreeMap = dict
    module.DynArray = list
    module.allow_storage = lambda cls: cls

    class _Keccak:
        def __init__(self, data: bytes) -> None:
            self._data = data

        def hexdigest(self) -> str:
            return hashlib.sha256(self._data).hexdigest()

    module.Keccak256 = _Keccak
    module.__all__ = ["gl", "u256", "Address", "TreeMap", "DynArray", "allow_storage", "Keccak256"]
    sys.modules["genlayer"] = module


def load_contract(gl: _Gl):
    install_stubs(gl)
    source = CONTRACT.read_text()
    # `@dataclass` resolves annotations through sys.modules, so the contract must execute inside a
    # module that is registered there rather than in a bare dict.
    name = "treasury_policy_under_test"
    module = types.ModuleType(name)
    sys.modules[name] = module
    exec(compile(source, str(CONTRACT), "exec"), module.__dict__)
    return module.__dict__


def build_policy(gl: _Gl, namespace: dict, destination_chains: str):
    policy_cls = namespace["TreasuryPolicy"]

    # The contract declares storage as class annotations, which GenVM materialises. Outside GenVM
    # the instance needs those containers created before __init__ populates them.
    instance = policy_cls.__new__(policy_cls)
    for name, annotation in policy_cls.__annotations__.items():
        if annotation is dict or getattr(annotation, "__origin__", None) is dict:
            setattr(instance, name, {})
        elif annotation is list or getattr(annotation, "__origin__", None) is list:
            setattr(instance, name, [])
    for name in ("whitelist", "whitelist_order", "allowed_destination_chains",
                 "destination_chain_order", "requests", "request_order", "evidence_keys"):
        if not hasattr(instance, name):
            setattr(instance, name, {} if name.endswith(("s",)) and "order" not in name else [])
    instance.whitelist = {}
    instance.whitelist_order = []
    instance.allowed_destination_chains = {}
    instance.destination_chain_order = []
    instance.requests = {}
    instance.request_order = []
    instance.evidence_keys = {}

    policy_cls.__init__(
        instance,
        "0x" + "1" * 40,            # registry
        "0x" + "2" * 40,            # owner
        "0x" + "3" * 40,            # authorized_agent
        "0x" + "4" * 40,            # execution_reporter
        "0x" + "5" * 40,            # delegated_account
        "0x" + "6" * 40,            # token_address
        "ctx",                      # delegation_context
        "none",                     # one_shot_method_id
        84532,                      # evm_chain_id
        25_000_000,                 # per_tx_cap_atto
        100_000_000,                # weekly_cap_atto
        0,                          # auto_approve_threshold_atto
        "Routine infrastructure spending only.",
        "none",                     # whitelist_csv
        "arc-vault",                # settlement_backend
        destination_chains,
    )
    return instance


def main() -> None:
    gl = _Gl()
    namespace = load_contract(gl)

    # 1. The settlement chain is always permitted, even with no configured allowlist.
    policy = build_policy(gl, namespace, "none")
    assert policy._is_allowed_destination("84532") is True, "settlement chain must be payable"
    assert policy._is_allowed_destination("5042002") is False, "unconfigured chain must be refused"
    assert policy.settlement_backend == "arc-vault"
    assert policy.vault_address == ""

    # 2. Configured destinations are permitted, and the settlement chain is not duplicated.
    policy = build_policy(gl, namespace, "5042002,84532")
    assert policy._is_allowed_destination("5042002") is True
    assert policy._active_destination_chains().count("84532") == 1, "settlement chain duplicated"
    assert set(policy._active_destination_chains()) == {"84532", "5042002"}

    # 3. A non-numeric destination list is rejected at construction.
    try:
        build_policy(gl, namespace, "not-a-chain")
    except UserError as error:
        assert "numeric" in str(error), f"unexpected error: {error}"
    else:
        raise AssertionError("a non-numeric destination chain was accepted")

    # 4. An unknown settlement backend is rejected.
    policy_cls = namespace["TreasuryPolicy"]
    try:
        instance = policy_cls.__new__(policy_cls)
        instance.whitelist = {}
        instance.whitelist_order = []
        instance.allowed_destination_chains = {}
        instance.destination_chain_order = []
        policy_cls.__init__(
            instance, "0x" + "1" * 40, "0x" + "2" * 40, "0x" + "3" * 40, "0x" + "4" * 40,
            "0x" + "5" * 40, "0x" + "6" * 40, "ctx", "none", 84532,
            25_000_000, 100_000_000, 0, "policy text", "none", "nonsense-backend", "none",
        )
    except UserError as error:
        assert "settlement backend" in str(error), f"unexpected error: {error}"
    else:
        raise AssertionError("an unknown settlement backend was accepted")

    # 5. The deterministic denial path stores a denial and never reaches the LLM.
    policy = build_policy(gl, namespace, "none")
    result = policy._store_deterministic_denial(
        "0x" + "a" * 64, "0x" + "7" * 40, 1_000_000, "infra", "justification",
        "", "0x" + "0" * 64, "", "5042002", "cctp",
        "Destination chain is not permitted by this policy",
    )
    assert result["verdict"] == "denied", result
    assert "Destination chain is not permitted" in result["reasoning"], result
    stored = policy.requests["0x" + "a" * 64]
    assert stored.destination_chain_id == "5042002"
    assert stored.route == "cctp"
    assert stored.execution_status == "not_applicable"
    assert stored.finalized is True
    assert stored.bridge_tx_hash == ""
    assert gl.nondet.calls == 0, "LLM review ran for a deterministically denied request"

    # 6. A direct route is recorded when the destination equals the settlement chain.
    policy._store_request(
        "0x" + "b" * 64, "0x" + "7" * 40, 1_000_000, "infra", "justification",
        "", "0x" + "0" * 64, "", "84532", "direct",
        "pending", "reviewing", "", "reviewing", False,
    )
    direct = policy.requests["0x" + "b" * 64]
    assert direct.route == "direct"
    assert direct.destination_chain_id == "84532"

    print("HARNESS_OK")


if __name__ == "__main__":
    main()
