const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const policy = process.env.GENLAYER_POLICY ?? process.env.NEXT_PUBLIC_GENLAYER_POLICY ?? "0xaC8727AA788B19e4344Ee8721d9E249B542022c8";
const delegatedAccount = process.env.DELEGATED_ACCOUNT ?? "0xEd9EDd8586b20524CafA4F568413C504C9B03172";
const token = process.env.TOKEN_ADDRESS ?? "0x0000000000000000000000000000000000000001";
const permissionContext = process.env.PERMISSION_CONTEXT ?? "0x1234";

const payload = {
  policy,
  chainId: Number(process.env.EVM_CHAIN_ID ?? "84532"),
  delegatedAccount,
  token,
  permissionContext,
  delegationPayload: [{
    delegate: "0x1072e78B72840BbC921493ea1C97dC5CAA54598F",
    delegator: delegatedAccount,
    authority: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    caveats: [],
    salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
    signature: "0x",
    context: permissionContext,
  }],
};

const response = await fetch(`${appUrl}/api/register-delegation`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const data = await response.json().catch(async () => ({ raw: await response.text() }));
console.log(JSON.stringify({ status: response.status, data }, null, 2));
if (!response.ok) process.exit(1);
