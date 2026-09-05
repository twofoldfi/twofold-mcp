import { createPublicClient, createWalletClient, http, parseAbi, getAddress,
  encodeAbiParameters, encodePacked, keccak256 } from "viem";
const RPC="http://127.0.0.1:8546", FORK=process.env.FORK_RPC;
const chain={id:4663,name:"rh",nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[RPC]}}};
const pub=createPublicClient({chain,transport:http(RPC),pollingInterval:20});
const rpc=(m,p)=>fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p})}).then(r=>r.json());
const SV=getAddress("0xf3334192d15450cdd385c8b70e03f9a6bd9e673b");
const Q=getAddress("0x8dc178efb8111bb0973dd9d722ebeff267c98f94");
const HOOK=getAddress("0x127b3f3b7769f659c5edbff8b4005443f19faac0");
const ROUTER=getAddress("0x8876789976decbfcbbbe364623c63652db8c0904");
const PERMIT2=getAddress("0x000000000022d473030f116ddee9f6b43ac78ba3");
const TWO=getAddress("0x2A4a33A2163D005d8E7f1D9aC08d14c98db288d5");
const USDG=getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const WETH=getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const DEP=getAddress("0xC8720447712e6C4c851B3884b4Ec93F9cE8aD5fD");
const WHALE=getAddress("0xBeEff033F34C046626B8D0A041844C5d1A5409dd");
const PK={type:"tuple",components:[{name:"currency0",type:"address"},{name:"currency1",type:"address"},{name:"fee",type:"uint24"},{name:"tickSpacing",type:"int24"},{name:"hooks",type:"address"}]};
const EIS={type:"tuple",components:[{...PK,name:"poolKey"},{name:"zeroForOne",type:"bool"},{name:"amountIn",type:"uint128"},{name:"amountOutMinimum",type:"uint128"},{name:"minHopPriceX36",type:"uint256"},{name:"hookData",type:"bytes"}]};
const id=(k)=>keccak256(encodeAbiParameters([PK],[k]));
const sort=(a,b)=>a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a];
const arr=(k)=>[k.currency0,k.currency1,k.fee,k.tickSpacing,k.hooks];
const [t0,t1]=sort(TWO,USDG); const kTU={currency0:t0,currency1:t1,fee:3000,tickSpacing:60,hooks:HOOK};
const [g0,g1]=sort(TWO,WETH); const kTW={currency0:g0,currency1:g1,fee:10000,tickSpacing:200,hooks:"0x0000000000000000000000000000000000000000"};
const [w0,w1]=sort(WETH,USDG); const kWU={currency0:w0,currency1:w1,fee:3000,tickSpacing:60,hooks:HOOK};
const isTU0=kTU.currency0.toLowerCase()===TWO.toLowerCase();
const SV_ABI=parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const Q_ABI=parseAbi(["function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) returns (uint256,uint256)"]);
const H=parseAbi(["function getReserves((address,address,uint24,int24,address)) view returns (uint256,uint256)",
  "function previewDeposit((address,address,uint24,int24,address),uint256) view returns (uint256,uint256)",
  "function addLiquidity((address,address,uint24,int24,address),uint256,uint256,uint256,uint256) returns (uint256,uint256)",
  "function getDistribution(bytes32) view returns ((int24,int24,uint16)[])"]);
const C=parseAbi(["function setDistribution((address,address,uint24,int24,address),(int24,int24,uint16)[])"]);
const OWN=parseAbi(["function owner() view returns (address)"]);
const E20=parseAbi(["function approve(address,uint256) returns (bool)","function balanceOf(address) view returns (uint256)","function transfer(address,uint256) returns (bool)"]);
const P2=parseAbi(["function approve(address,address,uint160,uint48)"]);
const UR=parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const wal=createWalletClient({account:DEP,chain,transport:http(RPC),pollingInterval:20});
const tick=async(k)=>(await pub.readContract({address:SV,abi:SV_ABI,functionName:"getSlot0",args:[id(k)]}))[1];
async function tx(req,acct=DEP,label="?"){
  try{const h=await wal.writeContract({...req,account:acct});
  const r=await pub.waitForTransactionReceipt({hash:h,pollingInterval:20,retryDelay:20});
  if(r.status!=="success")throw new Error(`tx reverted on-chain: ${label} (${h})`);return r;}
  catch(e){throw new Error(`${label}: ${String(e.shortMessage||e.message).slice(0,200)}`);}}
function swapInput(k,z,amountIn,tin,tout){
  const a=encodePacked(["uint8","uint8","uint8"],[0x06,0x0b,0x0f]);
  const sp=encodeAbiParameters([EIS],[{poolKey:k,zeroForOne:z,amountIn,amountOutMinimum:0n,minHopPriceX36:0n,hookData:"0x"}]);
  const st=encodeAbiParameters([{type:"address"},{type:"uint256"},{type:"bool"}],[tin,0n,true]);
  const tk=encodeAbiParameters([{type:"address"},{type:"uint256"}],[tout,0n]);
  return encodeAbiParameters([{type:"bytes"},{type:"bytes[]"}],[a,[sp,st,tk]]);
}
const align=(t,s)=>Math.round(t/s)*s;
const pad=(x)=>"0x"+x.toString(16).padStart(64,"0");
async function setBal(token,slot,addr,amount){
  const k=keccak256(encodeAbiParameters([{type:"address"},{type:"uint256"}],[addr,BigInt(slot)]));
  await rpc("anvil_setStorageAt",[token,k,pad(amount)]);
}
const fund=async()=>{ await setBal(USDG,1,DEP,10n**14n); await setBal(TWO,0,DEP,10n**27n); };


const BWSETS={wide:[1200,4200],mid:[600,2400],tight:[300,1200],vtight:[120,480]};
let BW=BWSETS.wide;
async function run(addUsdgTarget){
  await fund();
  // fair price from the genesis pool
  const gs=(await pub.readContract({address:SV,abi:SV_ABI,functionName:"getSlot0",args:[id(kTW)]}))[0];
  const ws=(await pub.readContract({address:SV,abi:SV_ABI,functionName:"getSlot0",args:[id(kWU)]}))[0];
  const pG=(Number(gs)/2**96)**2, pW=(Number(ws)/2**96)**2;
  const fair=(pW/pG)*1e12;                       // USD per TWO
  const c=align(Math.round(Math.log(pW/pG)/Math.log(1.0001)),60);
  const ctrl=getAddress(await pub.readContract({address:HOOK,abi:OWN,functionName:"owner"}));
  // step 1: recentre
  await tx({address:ctrl,abi:C,functionName:"setDistribution",args:[arr(kTU),[[c-BW[0],c+BW[0],7000],[c-BW[1],c+BW[1],3000]]],gas:2000000n},DEP,"setDistribution");
  // step 2: add depth BEFORE the unpinning sell, so the sell lands in a deep book
  if(addUsdgTarget>0){
    const probe=10n**12n;
    const [p0,p1]=await pub.readContract({address:HOOK,abi:H,functionName:"previewDeposit",args:[arr(kTU),probe]});
    const usdgPer=isTU0?p1:p0;                    // USDG (6dp) per probe shares
    const shares=probe*BigInt(Math.round(addUsdgTarget*1e6))/usdgPer;
    const [a0,a1]=await pub.readContract({address:HOOK,abi:H,functionName:"previewDeposit",args:[arr(kTU),shares]});
    const needUsdg=isTU0?a1:a0, needTwo=isTU0?a0:a1;
    for(const t of [TWO,USDG]) await tx({address:t,abi:E20,functionName:"approve",args:[HOOK,(1n<<256n)-1n],gas:200000n},DEP,"approve hook");
    await tx({address:HOOK,abi:H,functionName:"addLiquidity",args:[arr(kTU),shares,needTwo*2n,needUsdg*2n,BigInt(Math.floor(Date.now()/1e3)+1800)],gas:5000000n},DEP,"addLiquidity");
  }
  // step 3: unpin with a small sell
  await tx({address:TWO,abi:E20,functionName:"approve",args:[PERMIT2,(1n<<256n)-1n],gas:200000n},DEP,"approve permit2");
  await tx({address:PERMIT2,abi:P2,functionName:"approve",args:[TWO,ROUTER,(1n<<160n)-1n,(1n<<48n)-1n],gas:200000n},DEP,"permit2 TWO");
  // walk the price down to the band centre, not merely off MAX_TICK
  let sold=0n, iters=0;
  while(iters<40){
    const t=await tick(kTU);
    if(t<=c) break;
    const chunk=(iters<2?1000n:100000n)*10n**18n;
    try{ await tx({address:ROUTER,abi:UR,functionName:"execute",args:[encodePacked(["uint8"],[0x10]),
      [swapInput(kTU,isTU0,chunk,TWO,USDG)],BigInt(Math.floor(Date.now()/1e3)+1800)],gas:6000000n},DEP,"walk sell"); }
    catch(e){ break; }
    sold+=chunk; iters++;
  }
  const walkTick=await tick(kTU);
  const res=await pub.readContract({address:HOOK,abi:H,functionName:"getReserves",args:[arr(kTU)]});
  const usdgDepth=Number(isTU0?res[1]:res[0])/1e6;
  // the $100 buy
  await setBal(USDG,1,DEP,200n*10n**6n);
  await tx({address:USDG,abi:E20,functionName:"approve",args:[PERMIT2,(1n<<256n)-1n],gas:200000n},DEP,"approve permit2");
  await tx({address:PERMIT2,abi:P2,functionName:"approve",args:[USDG,ROUTER,(1n<<160n)-1n,(1n<<48n)-1n],gas:200000n},DEP,"permit2 USDG");
  const b0=await pub.readContract({address:TWO,abi:E20,functionName:"balanceOf",args:[DEP]});
  const t0b=await tick(kTU);
  let ok=true;
  try{await tx({address:ROUTER,abi:UR,functionName:"execute",args:[encodePacked(["uint8"],[0x10]),
    [swapInput(kTU,!isTU0,100n*10n**6n,USDG,TWO)],BigInt(Math.floor(Date.now()/1e3)+1800)],gas:6000000n});}
  catch(e){ok=false;}
  const b1=await pub.readContract({address:TWO,abi:E20,functionName:"balanceOf",args:[DEP]});
  const got=Number(b1-b0)/1e18;
  const eff=ok&&got>0?100/got:NaN;
  console.log(`band ${BW[0]}/${BW[1]} | add $${String(addUsdgTarget).padStart(6)} | depth $${usdgDepth.toFixed(2).padStart(9)} | $100 buy: ${ok?"ok ":"REVERT"} | got ${got.toFixed(0).padStart(8)} TWO | eff $${eff.toFixed(6)} vs fair $${fair.toFixed(6)} | premium ${((eff/fair-1)*100).toFixed(1)}% | tick ${t0b} -> ${await tick(kTU)} | walked to ${walkTick} (centre ${c}, sold ${Number(sold)/1e18} TWO)`);
}
await rpc("anvil_impersonateAccount",[DEP]);
await rpc("anvil_setBalance",[DEP,"0x56BC75E2D63100000"]);
for(const bname of (process.env.BANDS||"wide").split(",")){
 BW=BWSETS[bname];
 for(const a of (process.env.SET||"0").split(",").map(Number)) {
  const snap=(await rpc("evm_snapshot",[])).result;
  try{await run(a);}catch(e){console.log(`band ${bname} add $${a}: SETUP FAILED ${String(e.shortMessage||e.message).slice(0,140)}`);}
  await rpc("evm_revert",[snap]);
 }
 console.log("");
}
