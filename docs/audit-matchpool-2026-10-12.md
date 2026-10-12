# MatchPool v1 security audit (2026-10-12)

## Summary for judges

MatchPool is a 135-line, non-upgradeable contract with no owner, no admin keys and no native-coin handling. A sponsor locks stablecoins; each donation is matched up to a per-donor cap and forwarded, donation plus match, to one fixed recipient in the same transaction. The sponsor can take back only the unused remainder, and only after the lock ends. We found no way for anyone to steal funds, redirect funds to a third party, or pull the sponsor's money out early. All 40 Foundry tests pass (including two 1,000-run fuzz suites and re-entrancy tests), the live deployment's state matches the money invariants (pool 460 USD equals the contract's token balance; 500 deposited minus 40 matched), and the deployed runtime bytecode is byte-identical to this repository's build except for the constructor immutables. The real weaknesses are economic, not custodial: the per-donor cap is per address, so anyone with many wallets (including the recipient) can draw down the whole match pool; a donor gets no protection if the pool runs out or the lock ends between seeing a match quote and their transaction landing; and the sponsor address can never be changed, so a lost or blocked sponsor key strands the remainder. None of these put donor or sponsor funds at risk of going anywhere other than the recipient or the sponsor.

## Scope and method

| Item | Value |
| --- | --- |
| File | `contracts/src/MatchPool.sol` (135 lines) |
| Compiler | solc 0.8.28, evm `osaka` (pragma `^0.8.24`) |
| Deployed | Tempo Moderato testnet `0x02b1364d6d6a4a2a73665591d2083d25e7396a5f` |
| Deployed config (read on chain today) | token AlphaUSD TIP-20 `0x20c0...0001`, matchBps 10000 (1:1), perDonorCap 20 USD, lockUntil 1798761599 (31 Dec 2026 23:59:59 UTC), pool 460 USD, totalDonated 45 USD, totalMatched 40 USD, 5 donations, contract token balance 460 USD |
| Bytecode check | `cast code` vs `out/MatchPool.sol/MatchPool.json` deployedBytecode: 0 differing hex chars outside the 6 immutable reference ranges; metadata hash identical |
| Tests | `forge test`: 40 passed, 0 failed (20 core, 20 edge) |
| Method | solidity-auditor skill, DEEP mode: manual vector scan (reentrancy, access control, accounting, token return values, fee-on-transfer and rebasing, rounding, lock boundaries, griefing, front-running, blocked-recipient DoS, ownership rotation, events) plus an independent adversarial reasoning pass. Same bug classes as the prior ImpactHook audit were checked one by one (table below). |

No code was changed. Every fix below is a recommendation for a v2 deployment; the v1 contract on chain stays as is.

## Findings

Severity uses impact times likelihood for this deployment (testnet, AlphaUSD, 500 USD pool, immutable config).

| # | Severity | Title |
| --- | --- | --- |
| M-1 | Medium | Per-donor cap is per address: sybil and recipient self-dealing drain the match pool |
| M-2 | Medium | No minimum-match guard: donors can be raced to a zero match, and late donations silently get none |
| L-1 | Low | Sponsor is immutable with no recovery path: lost or blocked sponsor strands the remainder |
| L-2 | Low | Constructor accepts unusable or dangerous config (no bounds on lockUntil, matchBps, perDonorCap) |
| L-3 | Low | Recipient block, token pause or recipient policy change halts all donations |
| I-1 | Info | Token is trusted, not measured: fee-on-transfer or silent-memo tokens break accounting (not exploitable with AlphaUSD) |
| I-2 | Info | Tokens sent directly to the contract are stuck (known) |
| I-3 | Info | Event coverage gaps |
| I-4 | Info | Floating pragma and `osaka` target |

The manual vector scan and the independent adversarial pass reached the same top three findings (M-1, M-2, L-1) on their own. `docs/edge-cases.md` already notes that the cap counts addresses (line 77) and that donations still go through once the match is used up (line 68); M-1 and M-2 go further than those notes.

### M-1. Per-donor cap is per address: sybil and recipient self-dealing drain the match pool

- **Where:** `previewMatch` lines 123-125; `matchedBy` keyed by `msg.sender` (line 89).
- **Scenario:** The cap is 20 USD per address and the pool is 460 USD. One person with 23 funded wallets donates 20 USD from each and collects the full 460 USD of match. Worse, the recipient can do this with its own money: it donates 20 USD from wallet A, receives 40 USD back at the recipient address, and is up 20 USD of sponsor money per wallet. Its own donation is round-tripped, so the only cost is gas and the time to fund wallets. The existing edge test `test_recipientDonates_netGainIsMatch_boundedByCap` already notes this.
- **Lock escape:** the same loop lets a sponsor who controls or colludes with the recipient pull pool money out before `lockUntil`, which breaks the promise in the NatSpec at lines 103-104. The constructor (line 57) also allows `sponsor == recipient`, which makes this trivial. A helper contract that deploys a fresh caller per donation can run the whole drain in one transaction.
- **Impact:** No funds leave the sponsor-to-recipient path, so this is not theft in the custodial sense. It defeats the stated purpose ("match real donors, up to a per-donor cap"), and a matching pitch that says "your gift is doubled" becomes false for honest donors who arrive after the pool is drained.
- **Fix (v2):** set `matchAmount = 0` when `msg.sender` is `recipient` or `sponsor`, reject `recipient_ == sponsor_` in the constructor, and gate matching on a per-person proof rather than an address: a backend-signed EIP-712 voucher per donor (nonce, cap, expiry) checked in `donate`, an allowlist root, or a proof-of-personhood attestation. Cheaper partial mitigations: a minimum donation size and a per-block or per-day global match limit. At minimum, disclose in the UI that the cap is per wallet.

### M-2. No minimum-match guard: donors can be raced to a zero match, and late donations silently get none

- **Where:** `donate` lines 81-101; `previewMatch` lines 119-126 (returns 0 after lock, clamps to `pool` and to cap room).
- **Scenario:** The UI reads `previewMatch` and shows "your 20 becomes 40". Before the donor's transaction lands, other donations (or a front-runner on purpose) use up the pool, or the block timestamp passes `lockUntil`. `donate` does not revert; it forwards the donation with `matchAmount = 0`. The same happens to anyone who donates after 31 Dec 2026: the contract still accepts the money and acts as a plain forwarder with no match.
- **Impact:** Donor funds still reach the recipient, so nothing is lost, but the donor's consent was given on a promise the contract did not keep. On a busy match day this is the most likely user-visible failure.
- **Fix (v2):** add `uint256 minMatch` to `donate` and `revert MatchTooLow()` when `matchAmount < minMatch`; the UI passes the previewed value. Optionally revert donations after lock, or expose a separate unmatched path. For v1, the app should re-read `previewMatch` right before signing and show "match no longer available" when it is 0.

### L-1. Sponsor is immutable with no recovery path

- **Where:** `sponsor` line 32 (immutable); `withdrawRemainder` lines 105-114 pays only `sponsor`.
- **Scenario:** The sponsor key is lost, or the sponsor address is later blocked by a TIP-403 transfer policy on the token. After the lock, `withdrawRemainder` either cannot be called or reverts on `transfer` (covered by `test_sponsorBlocked_withdrawRevertsThenRecovers`, which recovers only because the block is lifted). The remainder is stuck forever.
- **Note on the prior audit class:** the ImpactHook issue was single-step admin rotation. MatchPool avoids that by having no rotation at all, which removes the hijack risk but adds this key-loss risk. That is a reasonable trade for a testnet demo.
- **Fix (v2):** `withdrawRemainder(address to)` (sponsor chooses the destination), and/or a two-step sponsor handover (`proposeSponsor` then `acceptSponsor`), and/or a long-stop rule that lets anyone push the remainder to the recipient a fixed time after the lock if the sponsor never withdraws.

### L-2. Constructor accepts unusable or dangerous config

- **Where:** constructor lines 48-66. Only zero addresses and `lockUntil <= now` are rejected.
- **Scenarios:** (a) `lockUntil` given in milliseconds instead of seconds locks the deposit for tens of thousands of years. (b) `matchBps == 0` or `perDonorCap == 0` deploys a pool that can never match, so every deposit is locked until `lockUntil` for nothing (`test_zeroBpsAndZeroCap_forwardsWithZeroMatch` shows the behaviour). (c) A very large `matchBps` makes `amount * matchBps` overflow for ordinary amounts, so `donate` reverts for everyone. (d) `sponsor == recipient` or `token == recipient` are accepted.
- **Impact:** Deploy-time mistakes only, by the deployer, against the deployer's own funds. The live deployment's values are sane (checked above).
- **Fix (v2):** `require(lockUntil_ <= block.timestamp + MAX_LOCK)`, `require(matchBps_ > 0 && matchBps_ <= MAX_BPS)`, `require(perDonorCap_ > 0)`, `require(recipient_ != sponsor_)`.

### L-3. Recipient block, token pause or policy change halts all donations

- **Where:** line 100 `transferWithMemo(recipient, ...)` is in the same transaction as the donation.
- **Scenario:** The token issuer pauses AlphaUSD, or a TIP-403 policy blocks the recipient or the MatchPool contract. Every `donate` reverts (`test_recipientBlocked_wholeDonateReverts`). Because `recipient` is immutable, there is no way to point the pool at a new address.
- **Impact:** Availability only. Atomic forwarding is the right safety choice (no money sits in the contract waiting); the sponsor's remainder is still recoverable after the lock as long as the sponsor itself is not blocked.
- **Fix (v2):** accept this as the cost of atomic forwarding, or add a pull-based fallback (credit the recipient and let it `claim()` later) if availability matters more than simplicity.

### I-1. Token is trusted, not measured

- **Where:** `deposit` line 74 credits `pool += amount` before and without checking the received balance; `donate` lines 99-100 forward `amount + matchAmount` without a balance delta; line 100 trusts `transferWithMemo` (no return value) to revert on failure.
- **Prior-audit classes:** fee-on-transfer over-credit and unchecked `transferFrom`. Return values of `transfer` and `transferFrom` are checked here (lines 77, 99, 113), so the unchecked-transferFrom class is fixed. The fee-on-transfer class is still present in the code pattern: with a fee or rebasing token, `pool` would exceed the real balance and the last withdraw or last matched donation would revert. With the AlphaUSD TIP-20 precompile (no transfer fee, no rebasing, reverts on failure) it is not exploitable. `test_tokenTrust_silentMemo_strandsFunds` documents the silent-memo case.
- **Fix (v2, if other tokens are ever allowed):** credit `balanceAfter - balanceBefore` in `deposit`, or restrict the constructor to a TIP-20 factory address check.

### I-2. Tokens sent directly to the contract are stuck (known)

`withdrawRemainder` pays `pool`, not `balanceOf(this)`. Any direct transfer is unrecoverable. Fix in v2 with a sponsor-only `sweep(excess = balance - pool)` after the lock.

### I-3. Event coverage gaps

- `Withdrawn(uint256)` has no indexed address; add the destination for indexers.
- No event at construction with the config (it is in the deploy transaction calldata, but an event makes indexing simpler).
- `Donated` does not include the recipient (fine while it is immutable; needed if v2 adds recipient changes).
- Events are emitted before external calls (lines 75, 96, 111). That is safe here because a failed call reverts the whole transaction, including the event.

### I-4. Floating pragma and `osaka` target

`pragma ^0.8.24` with `solc_version = 0.8.28` and `evm_version = "osaka"`. Pin the pragma to `0.8.28` in v2 so a future build cannot pick a different compiler. Bytecode on chain matches the 0.8.28 build today.

## Prior ImpactHook audit classes, checked here

| Prior finding | MatchPool status |
| --- | --- |
| Native ETH commingling | Not present. No `payable`, no `receive`/`fallback`; Tempo has no native gas coin in user flows. |
| Proxy-value bug (sentinel like `feeBps == 0` meaning "no milestone") | Not present. `matchBps == 0` and `perDonorCap == 0` only mean "zero match"; no value doubles as a flag. Lock state is a plain timestamp comparison. |
| Fee-on-transfer over-credit | Pattern present (I-1), not exploitable with AlphaUSD. |
| Single-step admin rotation | Not present: there is no admin and no rotation. Trade-off noted in L-1. |
| Unchecked `transferFrom` | Fixed: all three bool returns are checked; `transferWithMemo` relies on revert. |

## Vector scan results (no finding)

- **Re-entrancy:** checks-effects-interactions is followed in `deposit`, `donate` and `withdrawRemainder`; `pool` is decremented before any transfer. AlphaUSD has no transfer hooks. The four re-entrancy tests with a hostile mock token keep totals consistent.
- **Access control:** `deposit` and `withdrawRemainder` are sponsor-only; `donate` pulls only from `msg.sender` (no `from` argument), so an unlimited approval to MatchPool cannot be abused by a third party. No `delegatecall`, `selfdestruct`, arbitrary call or upgrade path.
- **Lock boundaries:** deposit and matching allowed while `timestamp <= lockUntil`; withdraw only when `timestamp > lockUntil`. The windows are disjoint, so the sponsor can never withdraw while matching is live, and a withdraw cannot be followed by a match (`test_lockBoundary_exact`, `test_reentrancy_withdrawDuringLateDonate`).
- **Rounding:** `amount * matchBps / BPS` floors, in the pool's favour. Dust donations get 0 match but are still forwarded and counted.
- **Overflow:** checked arithmetic everywhere except `++donationCount` (unreachable overflow).
- **Front-running the sponsor:** the sponsor cannot pull funds early, and cannot shrink the pool during the window. A sponsor donating to its own pool just moves its own money to the recipient early.
- **Withdraw twice:** second call pays 0 and does not revert.

## Invariants checked

| Invariant | Evidence |
| --- | --- |
| `pool + totalMatched == sum(deposits) - sum(withdrawn)` | Code reading (lines 74, 88-90, 109-110); `testFuzz_sequences_conservation` (1,000 runs); on chain today: 460 + 40 = 500 deposited |
| `token.balanceOf(this) == pool` (absent direct transfers) | Fuzz suite; on chain today: balance 460 USD equals `pool` 460 USD |
| `matchedBy[d] <= perDonorCap` for every donor | Lines 123-125; fuzz and cap tests |
| `matchAmount <= amount * matchBps / BPS` and `<= pool` | Lines 121-122 |
| Each `donate` delivers exactly `amount + matchAmount` to `recipient` atomically or reverts | Lines 99-100; `testFuzz_recipientGetsAmountPlusMatch` |
| Funds can only move to `recipient` (via donate) or `sponsor` (via withdraw after lock) | Only three transfer call sites (lines 77, 99-100, 113) |
| No match after `lockUntil`; no withdraw at or before `lockUntil` | Lines 72, 107, 120 |
| Deployed bytecode equals repo build | Runtime bytecode diff limited to the 6 immutable ranges |

## Test gaps

1. **No test against the real AlphaUSD precompile.** All tests use `MockTIP20`. A Tempo fork test (or a scripted testnet run) should cover `transferWithMemo` semantics, TIP-403 policy blocks on the contract, sponsor and recipient, and token pause.
2. **No handler-based `forge` invariant test.** The sequence fuzz is good; a `StdInvariant` handler with `invariant_` functions would also explore cross-actor orderings (many donors, sponsor deposits, time warps) without a fixed op layout.
3. **No test for the stale-quote case (M-2):** a donation whose preview was non-zero but executes with 0 match.
4. **No constructor extreme tests (L-2):** `lockUntil` far in the future, `matchBps` large enough to overflow `donate` for normal amounts, `sponsor == recipient`.
5. **Event assertions are thin:** 4 `expectEmit` checks in the core suite, none in the edge suite; `Withdrawn(0)` on a second withdraw is asserted by log inspection only.
6. **No bytecode-match check in CI:** the comparison in this audit was manual; a script that diffs `cast code` against the build (masking immutables) would catch drift between repo and deployment.
