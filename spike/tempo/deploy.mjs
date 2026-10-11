import { walletActions, encodeAbiParameters, createClient, http, publicActions, toHex, parseAbi } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { tempoActions } from 'viem/tempo'
import fs from 'fs'
const k=n=>JSON.parse(fs.readFileSync(`w_${n}.json`))[0].private_key
const art=JSON.parse(fs.readFileSync('out/MatchPool.sol/MatchPool.json'))
const alpha='0x20c0000000000000000000000000000000000001'
const A=privateKeyToAccount(k('a')), B=privateKeyToAccount(k('b'))
const charity=privateKeyToAccount(generatePrivateKey()).address
const mk=a=>createClient({account:a,chain:tempoModerato,transport:http()}).extend(publicActions).extend(walletActions).extend(tempoActions())
const cA=mk(A), cB=mk(B)
const vb=()=>Math.floor(Date.now()/1000)+240
const abi=art.abi
const erc=parseAbi(['function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)'])
const wait=async(c,h)=>{const r=await c.waitForTransactionReceipt({hash:h});return r}
const step=async(name,fn)=>{try{const h=await fn();const r=await wait(cA,h);console.log(name,h,r.status,r.contractAddress||'');return r}catch(e){console.log(name,'ERR',(e.shortMessage||e.message).slice(0,300))}}
let r=await step('deploy',()=>cA.sendTransaction({gas:6000000n,validBefore:vb(),feeToken:alpha,
  data:(art.bytecode.object+ encodeAbiParameters([{type:'address'},{type:'address'},{type:'address'}],[alpha,A.address,charity]).slice(2))}))
if(!r) process.exit()
const pool=r.contractAddress
console.log('charity',charity)
await step('A approve',()=>cA.writeContract({address:alpha,abi:erc,functionName:'approve',args:[pool,5_000_000n],gas:300000n,feeToken:alpha,validBefore:vb()}))
await step('A deposit 5',()=>cA.writeContract({address:pool,abi,functionName:'deposit',args:[5_000_000n],gas:3000000n,feeToken:alpha,validBefore:vb()}))
await step('B approve',()=>cB.writeContract({address:alpha,abi:erc,functionName:'approve',args:[pool,2_000_000n],gas:300000n,feeToken:alpha,validBefore:vb()}))
await step('B donate 2 (match)',()=>cB.writeContract({address:pool,abi,functionName:'donate',args:[2_000_000n,toHex('don-1',{size:32})],gas:3000000n,feeToken:alpha,validBefore:vb()}))
console.log('charity bal',await cA.readContract({address:alpha,abi:erc,functionName:'balanceOf',args:[charity]}))
console.log('pool left',await cA.readContract({address:pool,abi,functionName:'pool'}))
await step('A refund',()=>cA.writeContract({address:pool,abi,functionName:'refund',gas:300000n,feeToken:alpha,validBefore:vb()}))
console.log('pool left',await cA.readContract({address:pool,abi,functionName:'pool'}))
