import { createClient, http, publicActions, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { tempoActions } from 'viem/tempo'
import fs from 'fs'
const k=n=>JSON.parse(fs.readFileSync(`w_${n}.json`))[0].private_key
const alpha='0x20c0000000000000000000000000000000000001'
const A='0x5A762ad2E7Bf8e372a7a26b5F6Bb295dCe69fd41'
const b=privateKeyToAccount(k('b')), sp=privateKeyToAccount(k('sponsor'))
const c=createClient({account:b,chain:tempoModerato,transport:http()}).extend(publicActions).extend(tempoActions())
const vb=()=>Math.floor(Date.now()/1000)+240
for (const memo of [false,true]) {
 try{
  const {receipt}=await c.token.transferSync({token:alpha,to:A,amount:1_000_000n,...(memo?{memo:toHex('sp',{size:32})}:{}),feePayer:sp,gas:300000n,validBefore:vb()})
  console.log('memo',memo,receipt.transactionHash,receipt.status)
 }catch(e){console.log('memo',memo,'ERR',(e.shortMessage||e.message).slice(0,200))}
}
