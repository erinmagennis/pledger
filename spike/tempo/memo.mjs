import { createClient, http, publicActions, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { tempoActions } from 'viem/tempo'
import fs from 'fs'
const k=n=>JSON.parse(fs.readFileSync(`w_${n}.json`))[0].private_key
const account=privateKeyToAccount(k('a'))
const client=createClient({account,chain:tempoModerato,transport:http()}).extend(publicActions).extend(tempoActions())
const alpha='0x20c0000000000000000000000000000000000001'
const to='0x420ff9871fa9Dc61232356F2c37c7C5E42EC0967'
const {receipt}=await client.token.transferSync({token:alpha,to,amount:10_000_000n,memo:toHex('match-001',{size:32}),feeToken:alpha})
console.log('memo tx',receipt.transactionHash,receipt.status,receipt.blockNumber)
