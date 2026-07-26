# Live Policy Test Report - July 26, 2026

## Scope

This report records two live Base Sepolia requests submitted through the public
agent API against a policy whose natural-language rule was limited to Vercel
subscriptions. The bearer credential is intentionally omitted and must be
rotated because it was disclosed outside a secret manager.

Both requests used `5.000001 USDC`, one atomic unit above the configured legacy
fast-approval limit, so GenLayer evaluated them with
`gl.eq_principle.prompt_comparative`.

## Results

### OpenAI request

- Expected: denied
- Actual: denied
- Reason: `Not a Vercel subscription`
- Request ID:
  `0xa5745a572997aaae190a131c73f01b5f4b272e86866e2fd20f8eb8ecb86e7e8d`
- GenLayer request transaction:
  `0x239219b46664865520777fc4b982540654bfa8d435a7c21f5b6890173fde1acc`
- EVM payment: none

### Vercel request

- Expected: approved
- Actual: approved and executed
- Request ID:
  `0xfdb372b4f3ac10e058c96a77fed04df2b24a363506bb0ebd0120f5bc865cefaf`
- GenLayer request transaction:
  `0xd54b28c11452569f445137ccda67b43d2e84be7b11becb8db2c661560a76cc22`
- Base Sepolia transaction:
  `0x0d5c45f88f4f6986a64439e5359d9504d26a218fb3a633c5af4b423a53e8c677`
- GenLayer execution-record transaction:
  `0xbb3a5f7eba076da68fd9b9b13e17d2f1dcfb4981693c652eaec903e64038134e`
- EVM receipt status: success

The Vercel request was replayed with the same idempotency key. The API returned
the same request ID and Base transaction hash, with no new GenLayer submission
or execution-record transaction. No duplicate payment occurred.

## Security Findings

### Critical: merchant identity was not verified

The approved request paid the owner's address. Approval was based on the
agent-provided category and justification saying "Vercel"; neither field proves
that the recipient belongs to Vercel or that an invoice is genuine.

Until evidence-backed requests are implemented, merchant-specific policies
must contain the exact approved recipient address and should enable the
recipient whitelist. A human-readable merchant name alone is not a payment
identity.

### High: legacy fast approval bypasses policy meaning

Policy contract V2 approves requests at or below the configured threshold after
only cap and whitelist checks. An out-of-policy request below `5 USDC` could
therefore bypass prompt-comparative review.

Policy V3 disables this shortcut and requires prompt-comparative review for
every request. Owners of V2 policies should set the fast-approval limit to `0`
immediately and re-register delegation to migrate.

### Medium: fee accounting was not explicit

The delegated account balance reflected both the payment transaction and a
small 1Shot fee, while weekly policy usage tracked only the requested payment
amount. The spend response now exposes the current relayer fee estimate
separately when execution happens in the same request.

### Medium: long-running request progress was opaque

Comparative review and execution can take minutes. Clients must use a stable
idempotency key, retain the request ID, and poll the request endpoint after an
ambiguous timeout. The API now returns chain, decision mode, replay, execution,
and fee metadata to make this lifecycle clearer.

## Required Follow-up

1. Rotate the disclosed API key.
2. Set every legacy V2 fast-approval limit to `0`.
3. Re-register active agents to deploy policy V3.
4. Add evidence-backed merchant and invoice verification before restoring fast
   approval.
5. Store payment amount, relayer fee, and total delegated consumption as
   separate authoritative fields in the next policy schema.
