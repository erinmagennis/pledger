import { createClient, http, publicActions, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { tempoActions, withRelay } from 'viem/tempo'
import fs from 'fs'
const k=n=>JSON.parse(fs.readFileSync(`w_${n}.json`))[0].private_key
const alpha='0x20c0000000000000000000000000000000000001'
const A='0x5A762ad2E7Bf8e372a7a26b5F6Bb295dCe69fd41'
const b=privateKeyToAccount(k('b')), sp=privateKeyToAccount(k('sponsor'))
const bal=async(c,a)=>c.token.getBalance({token:alpha,account:a})
// 1) local fee payer account
const c1=createClient({account:b,chain:tempoModerato,transport:http()}).extend(publicActions).extend(tempoActions())
const b0=await bal(c1,b.address), s0=await bal(c1,sp.address)
try{
 const {receipt}=await c1.token.transferSync({token:alpha,to:A,amount:1_000_000n,memo:toHex('sponsored-1',{size:32}),feePayer:sp,validBefore:Math.floor(Date.now()/1000)+240})
 console.log('local feePayer tx',receipt.transactionHash,receipt.status)
 console.log('B delta',(await bal(c1,b.address))-b0,'sponsor delta',(await bal(c1,sp.address))-s0)
}catch(e){console.log('local feePayer ERR',e.shortMessage||e.message)}
// 2) public relay
const c2=createClient({account:b,chain:tempoModerato,transport:withRelay(http(),http('https://sponsor.moderato.tempo.xyz'))}).extend(publicActions).extend(tempoActions())
const b1=await bal(c2,b.address)
try{
 const {receipt}=await c2.token.transferSync({token:alpha,to:A,amount:1_000_000n,feePayer:true,validBefore:Math.floor(Date.now()/1000)+240})
 console.log('relay tx',receipt.transactionHash,receipt.status,'B delta',(await bal(c2,b.address))-b1)
}catch(e){console.log('relay ERR',e.shortMessage||e.message)}
