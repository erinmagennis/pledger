# Pledger

Pledges with the money already in place.

When someone promises money (a match, a prize, a payout), Pledger shows whether it is actually there. A sponsor locks the pool up front. Every donation is matched the moment it is made. Anyone can see what was promised, what is locked, and what has been paid out.

Built for Colosseum's Crypto World's Fair (Sep 14 to Oct 12, 2026). Lead chain: Tempo. Claims and payouts for the first live pool: Base.

## Status (Oct 12)

- `contracts/`: **MatchPool v1** (Foundry). The sponsor's match is locked until a set date and cannot be taken back before it. Each donation is matched up to a ratio and a per-donor cap, then donation plus match goes to the recipient with a receipt memo. 20 tests pass, including a 1,000-run fuzz test. See `contracts/README.md`.
- `design/`: the approved home page design (`home-v3.html`, screenshot `home-v3.png`) and the design tokens (`tokens.css`). Numbers on the page are sample data.
- `spike/tempo/`: the first feasibility spike on Tempo's Moderato testnet (chain 42431). Verified donation tx `0xf9d5d6a1db04729828319cbb37912b7a3f19f4f3e10a98428099199614567368` and refund tx `0xd9b17d5ecb1a859e36b6839b586e466dd1e02e401353f339c16bea474cebf67d` (https://explore.testnet.tempo.xyz).

In progress:
- The web app at pledger.impacthook.org: live pledges, a test match pool anyone can try with free test money, and the first real pledge.
- The first real pledge is a give-back. People who paid Artizen's 10% endowment fee can claim it back from half of the builder's winnings. Claims are checked automatically from the signature on Artizen's receipt emails (DKIM), so nobody uploads screenshots. Each receipt can be claimed once. Payments go out on Base, inside Pledger or directly from any wallet, and Pledger checks each one on chain. Verified claims and payments are recorded publicly with EAS attestations on Base.

## For judges

- What is tested and how: `docs/TESTING.md`. Edge cases and how each is handled: `docs/edge-cases.md`.
- Run the contract tests: `cd contracts && forge test` (40 tests).
- The design the app is built from: `design/home-v3.png`.

## Related projects

Designed to be compatible with two earlier projects by the same builder: ImpactHook (milestone-gated funding on EVM) and Pantheon (AI committees that issue signed verdicts).

## License

MIT
