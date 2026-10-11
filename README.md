# Pledger

Pledges with the money already in place.

When someone promises money (a match, a prize, a payout), Pledger shows whether it is actually there. A sponsor locks the pool up front. Every donation is matched the moment it is made. Anyone can see what was promised, what is locked, and what has been paid out.

Built for Colosseum's Crypto World's Fair (Sep 14 to Oct 12, 2026). Lead chain: Tempo. Claims and payouts for the first live pool: Base.

## Status

Early build. What exists today:

- `spike/tempo/`: feasibility spike on Tempo's Moderato testnet (chain 42431). A `MatchPool` contract that takes a sponsor deposit, matches each donation 1:1 in the same transaction, sends the total to the recipient with a payment memo, and refunds the remainder to the sponsor. Includes scripts for memo transfers and fee-sponsored transactions (donors pay no gas).
  - Verified on testnet: donation tx `0xf9d5d6a1db04729828319cbb37912b7a3f19f4f3e10a98428099199614567368`, refund tx `0xd9b17d5ecb1a859e36b6839b586e466dd1e02e401353f339c16bea474cebf67d` (https://explore.testnet.tempo.xyz).
  - Known limits of the spike: one recipient per pool, the sponsor can refund at any time (the real version locks the pool until a deadline), no per-donor caps yet.

## Related projects

Designed to be compatible with two earlier projects by the same builder: ImpactHook (milestone-gated funding on EVM) and Pantheon (AI committees that issue signed verdicts).

## License

MIT
