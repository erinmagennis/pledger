# MatchPool v1

A sponsor locks a matching pool for one recipient. Every donation is matched and sent, donation plus match, straight to the recipient with a memo. The contract never holds donor money.

## What it guarantees

- The recipient is fixed at deploy. Each donation sends exactly `amount + match` to it in the same transaction, using `transferWithMemo`.
- The match is `min(amount * matchBps / 10000, pool, perDonorCap - matchedBy[donor])`. `matchBps = 10000` is 1:1.
- One donor can never get more than `perDonorCap` of match in total.
- The sponsor can take money back only with `withdrawRemainder()`, only after `lockUntil`, and only what is still unused. There is no other path out.
- After `lockUntil`, donations still go through but get no match, and the sponsor cannot deposit more.
- At exactly `lockUntil` the window is still open (match yes, withdraw no). Both checks use `block.timestamp > lockUntil`.

## Functions

| Function | Who | What |
|---|---|---|
| `constructor(token, sponsor, recipient, matchBps, perDonorCap, lockUntil, name)` | deployer | Sets config. All config is immutable. `lockUntil` must be in the future. |
| `deposit(amount)` | sponsor | Pulls `amount` from sponsor into the pool. Window must be open. |
| `donate(amount, memo)` | anyone | Pulls `amount` from donor, adds the match, sends both to recipient with `memo`. Returns the match. |
| `withdrawRemainder()` | sponsor | After `lockUntil`, sends the unused pool to the sponsor. |
| `previewMatch(donor, amount)` | view | Match a donation would get right now. |
| `summary()` | view | `(pool, totalDonated, totalMatched, donationCount, lockUntil)` |
| `pool`, `totalDonated`, `totalMatched`, `donationCount`, `matchedBy(addr)` | view | State getters. |

Events: `Deposited(sponsor, amount)`, `Donated(donor, amount, matchAmount, memo)`, `Withdrawn(amount)`.

## Build and test

```
forge build
forge test -vv
```
