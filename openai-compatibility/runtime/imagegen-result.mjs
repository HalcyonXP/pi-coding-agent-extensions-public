// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import {createHash} from 'node:crypto';
import {imageInput} from './image-input.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const shape=(v,required,optional=[])=>object(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const digest=(content,details)=>createHash('sha256').update(JSON.stringify({content,details})).digest('hex');
function normal(result, stamped){
 if(!shape(result,['content','details'],['isError'])||Object.hasOwn(result,'isError')&&result.isError!==false)return false;
 const d=result.details;
 if(!shape(d,['status','operation','canonicalPath',...(stamped?['imagegen_result']:[])],['destinationPath','background','quality','size'])||d.status!=='completed'||!['generate','edit'].includes(d.operation)||!text(d.canonicalPath,4096))return false;
 if(Buffer.byteLength(d.canonicalPath)>4096)return false;
 if(d.destinationPath!==undefined&&(!text(d.destinationPath,4096)||Buffer.byteLength(d.destinationPath)>4096))return false;
 if(d.background!==undefined&&!['transparent','opaque','auto'].includes(d.background))return false;
 if(d.quality!==undefined&&!['low','medium','high','auto'].includes(d.quality))return false;
 if(d.size!==undefined&&!text(d.size,128))return false;
 const c=result.content;
 return Array.isArray(c)&&c.length===2&&shape(c[0],['type','data','mimeType'])&&c[0].type==='image'&&c[0].mimeType==='image/png'&&imageInput(c[0],8*1024*1024,false)!==undefined&&shape(c[1],['type','text'])&&c[1].type==='text'&&text(c[1].text,16384);
}
// Consistency metadata, not a signature/authority. Preserve original JS optional
// undefined fields; JSON finalization naturally omits them at its existing boundary.
export function sealImagegenResult(result){
 if(!normal(result,false))return result;
 return {...result,details:{...result.details,imagegen_result:{version:1,sha256:digest(result.content,result.details)}}};
}
export function normalImagegenProjection(result){
 if(!normal(result,true))return false;
 const {imagegen_result:stamp,...details}=result.details;
 return shape(stamp,['version','sha256'])&&stamp.version===1&&typeof stamp.sha256==='string'&&stamp.sha256===digest(result.content,details);
}
