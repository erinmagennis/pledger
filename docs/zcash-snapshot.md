# Zcash snapshot script

`app/scripts/zcash-snapshot.mjs` scans a Zcash viewing key and writes the JSON that the Zcash pledge page reads. It needs Node 22+. It only ever sees the viewing key (UFVK), never a seed.

## Setup

The scanner package is not in package.json. Install it without saving:

    npm i --no-save @ledgerhq/zcash-utils@2.6.0

If it is missing, the script prints that line and exits with code 2.

## Usage

    node scripts/zcash-snapshot.mjs --network mainnet|testnet \
      --ufvk <key> --address <ua> --birthday <height> \
      [--server https://zec.rocks:443] [--out src/content/zcash-pledge.<network>.json] \
      [--label "..."] [--dry-run]

- `--server` defaults to `https://zec.rocks:443` (mainnet) or `https://testnet.zec.rocks:443` (testnet).
- `--out` defaults to `src/content/zcash-pledge.<network>.json`. Run from the `app` folder.
- `--dry-run` prints the JSON and writes nothing.
- `published` keeps the value in the existing output file, or `false` for a new file.

It prints one summary line, for example:

    testnet tip 4492967, scanned 268 blocks in 486ms, 0 tx, balance 0 zat (0 TAZ), dry run, nothing written, WARNING: 2 decrypt error(s), see scanNote

## Output

Balance is the sum of unspent incoming notes. `transactions` lists txid, height, direction (in or out) and value in zat. `pledgeTx` is the first incoming transaction. `outgoingTx` is the latest outgoing one, if any. Pool is Ironwood on mainnet and Orchard on testnet.

## Known limit: testnet NU7

Public testnet activated NU7 at height 4465026. `@ledgerhq/zcash-utils` 2.6.0 cannot parse those transactions ("invalid consensus branch id 0x77190ad9"). The scanner skips them, so the balance reads 0 and the transaction list is empty. The script reports this and adds a `scanNote` field to the JSON. For testnet, check with zingo-cli (the `verifyCommand` field) and edit the numbers by hand, or wait for a package release built on zcash_protocol 0.11. Mainnet is not affected.
