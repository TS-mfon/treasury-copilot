# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass

ERROR_EXPECTED = "[EXPECTED]"


def _lower(value: str) -> str:
    return str(value).strip().lower()


@allow_storage
@dataclass
class RegisteredPolicy:
    owner: str
    agent: str
    policy: str
    chain_id: u256
    delegated_account: str
    token_address: str
    token_symbol: str
    token_decimals: u256
    active: bool
    created_at: str
    api_key_version: u256


class TreasuryRegistry(gl.Contract):
    owner: Address
    policies: TreeMap[str, RegisteredPolicy]
    policy_order: DynArray[str]
    owner_index: TreeMap[str, str]
    agent_index: TreeMap[str, str]

    def __init__(self):
        self.owner = gl.message.sender_address

    @gl.public.write
    def register_policy(
        self,
        owner: Address,
        agent: Address,
        policy: Address,
        chain_id: u256,
        delegated_account: Address,
        token_address: Address,
        token_symbol: str,
        token_decimals: u256,
    ) -> dict:
        policy_key = _lower(str(policy))
        try:
            existing = self.policies[policy_key].policy
        except KeyError:
            existing = ""
        if str(existing) != "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Policy already registered")

        owner_key = _lower(str(owner))
        agent_key = _lower(str(agent))
        self.policies[policy_key] = RegisteredPolicy(
            owner=owner_key,
            agent=agent_key,
            policy=policy_key,
            chain_id=chain_id,
            delegated_account=_lower(str(delegated_account)),
            token_address=_lower(str(token_address)),
            token_symbol=str(token_symbol).upper(),
            token_decimals=token_decimals,
            active=True,
            created_at="accepted",
            api_key_version=u256(1),
        )
        self.policy_order.append(policy_key)
        self.owner_index[owner_key] = self._append_csv(self._read_index(self.owner_index, owner_key), policy_key)
        self.agent_index[agent_key] = self._append_csv(self._read_index(self.agent_index, agent_key), policy_key)
        return self.get_policy(policy_key)

    @gl.public.view
    def get_policy(self, policy: str) -> dict:
        item = self.policies[_lower(policy)]
        return {
            "owner": item.owner,
            "agent": item.agent,
            "policy": item.policy,
            "chain_id": str(item.chain_id),
            "delegated_account": item.delegated_account,
            "token_address": item.token_address,
            "token_symbol": item.token_symbol,
            "token_decimals": str(item.token_decimals),
            "active": item.active,
            "created_at": item.created_at,
            "api_key_version": str(item.api_key_version),
        }

    @gl.public.write
    def set_policy_active(self, policy: Address, active: bool) -> dict:
        policy_key = _lower(str(policy))
        item = self.policies[policy_key]
        if gl.message.sender_address != Address(item.owner) and gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner")
        item.active = active
        self.policies[policy_key] = item
        return self.get_policy(policy_key)

    @gl.public.write
    def rotate_api_key(self, policy: Address) -> dict:
        policy_key = _lower(str(policy))
        item = self.policies[policy_key]
        if gl.message.sender_address != Address(item.owner) and gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner")
        item.api_key_version = item.api_key_version + u256(1)
        self.policies[policy_key] = item
        return self.get_policy(policy_key)

    @gl.public.view
    def list_policies(self) -> list[str]:
        result = []
        for policy in self.policy_order:
            result.append(policy)
        return result

    @gl.public.view
    def policies_for_owner(self, owner: str) -> list[str]:
        return self._split_csv(self._read_index(self.owner_index, _lower(owner)))

    @gl.public.view
    def policies_for_agent(self, agent: str) -> list[str]:
        return self._split_csv(self._read_index(self.agent_index, _lower(agent)))

    def _read_index(self, index: TreeMap[str, str], key: str) -> str:
        try:
            return index[key]
        except KeyError:
            return ""

    def _append_csv(self, existing: str, value: str) -> str:
        if existing == "":
            return value
        return existing + "," + value

    def _split_csv(self, value: str) -> list[str]:
        result = []
        for item in str(value).split(","):
            cleaned = _lower(item)
            if cleaned != "":
                result.append(cleaned)
        return result
