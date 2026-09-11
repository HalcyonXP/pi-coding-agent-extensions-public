// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Shared bounded wire validation. Signatures identify containers, not decoded pixels.
export const INLINE_IMAGE_BYTES = 32 * 1024;
export const INLINE_IMAGE_LABEL = "Code image helper: guest-provided inline image, not a native tool result or proof of generation/save.";
export function createImageInput() {
  const keys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor, array = Array.isArray;
  const create = Object.create, call = Function.prototype.call, ceil = Math.ceil, has = Object.hasOwn, integer = Number.isSafeInteger;
  const test = call.bind(RegExp.prototype.test), exec = call.bind(RegExp.prototype.exec);
  const index = call.bind(String.prototype.indexOf);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const url = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
  function fields(value, expected) {
    if (!value || typeof value !== "object" || array(value)) return undefined;
    const own = keys(value);
    if (own.length !== expected.length) return undefined;
    const result = create(null);
    for (let i=0;i<expected.length;i++) {
      const key=expected[i], d=descriptor(value,key);
      if (!d || !has(d,"value")) return undefined;
      result[key]=d.value;
    }
    return result;
  }
  function canvas(data, mime, length) {
    // Random access to bounded base64 bytes avoids an unbounded decoded JS array.
    const b = i => { const at=(i/3|0)*4,n=i%3,a=index(alphabet,data[at+n]),c=index(alphabet,data[at+n+1]);return n===0?(a<<2|c>>4)&255:n===1?(a<<4|c>>2)&255:(a<<6|c)&255; };
    const le16=i=>b(i)|(b(i+1)<<8),be16=i=>(b(i)<<8)|b(i+1);
    const le32=i=>(b(i)|b(i+1)<<8|b(i+2)<<16|b(i+3)<<24)>>>0;
    const be32=i=>(b(i)<<24|b(i+1)<<16|b(i+2)<<8|b(i+3))>>>0;
    const fits=(w,h)=>w>0&&h>0&&w<=4096&&h<=4096&&w*h<=4194304;
    const tag=(i,a,c,d,e)=>b(i)===a&&b(i+1)===c&&b(i+2)===d&&b(i+3)===e;
    if(mime==="image/png") {
      if(length<45||be32(8)!==13||!tag(12,73,72,68,82)||!fits(be32(16),be32(20)))return false;
      let at=8,idat=false;
      for(let n=0;n<128&&at+12<=length;n++) {
        const size=be32(at),kind=at+4,end=at+12+size;if(end>length)return false;
        if(at!==8&&tag(kind,73,72,68,82)||tag(kind,97,99,84,76)||tag(kind,102,99,84,76)||tag(kind,102,100,65,84))return false; // No duplicate IHDR/APNG.
        if(tag(kind,73,68,65,84))idat=true;
        if(tag(kind,73,69,78,68))return size===0&&idat&&end===length;
        at=end;
      }
      return false;
    }
    if(mime==="image/jpeg") {
      if(length<16||b(length-2)!==255||b(length-1)!==217)return false;
      let at=2,frame=false;
      for(let n=0;n<128&&at+4<=length;n++) {
        if(b(at++)!==255)return false;
        let pads=0;while(b(at)===255&&pads++<32)at++;
        const marker=b(at++),size=be16(at);if(size<2||at+size>length)return false;
        if(marker===192||marker===193||marker===194) {
          if(frame||size<8||!fits(be16(at+5),be16(at+3)))return false;frame=true;
        }else if(marker===218)return frame&&size>=6;
        else if(!(marker>=224&&marker<=239||marker===219||marker===196||marker===221||marker===254))return false;
        at+=size;
      }
      return false;
    }
    if(mime==="image/gif") {
      if(length<14)return false;const width=le16(6),height=le16(8);if(!fits(width,height))return false;
      let at=13+(b(10)&128?3*(2<<(b(10)&7)):0),frames=0;
      const blocks=()=>{for(let n=0;n<128&&at<length;n++){const size=b(at++);if(!size)return true;if(at+size>length)return false;at+=size;}return false;};
      for(let n=0;n<128&&at<length;n++) {
        const kind=b(at++);
        if(kind===59)return frames===1&&at===length;
        if(kind===33){if(at>=length)return false;at++;if(!blocks())return false;}
        else if(kind===44){if(++frames!==1||at+9>length)return false;const w=le16(at+4),h=le16(at+6);if(!fits(w,h)||le16(at)+w>width||le16(at+2)+h>height)return false;const packed=b(at+8);at+=9+(packed&128?3*(2<<(packed&7)):0);if(at>=length||b(at)<2||b(at)>8)return false;at++;if(!blocks())return false;}
        else return false;
      }
      return false;
    }
    if(mime==="image/webp") {
      if(length<20||le32(4)!==length-8)return false;let at=12,frames=0,cw=0,ch=0;
      for(let n=0;n<128&&at+8<=length;n++) {
        const size=le32(at+4),start=at+8,end=start+size+(size%2);if(end>length)return false;
        if(tag(at,86,80,56,88)){if(at!==12||size!==10||b(start)&2)return false;cw=(b(start+4)|b(start+5)<<8|b(start+6)<<16)+1;ch=(b(start+7)|b(start+8)<<8|b(start+9)<<16)+1;if(!fits(cw,ch))return false;}
        else if(tag(at,86,80,56,32)||tag(at,86,80,56,76)) {
          if(++frames!==1)return false;let w,h;
          if(b(at+3)===76){if(size<5||b(start)!==47)return false;const bits=le32(start+1);if(bits>>>29)return false;w=(bits&16383)+1;h=((bits>>>14)&16383)+1;}
          else{if(size<10||b(start)&1||b(start+3)!==157||b(start+4)!==1||b(start+5)!==42)return false;w=le16(start+6)&16383;h=le16(start+8)&16383;}
          if(!fits(w,h)||cw&&(w!==cw||h!==ch))return false;
        }else if(!(tag(at,65,76,80,72)||tag(at,73,67,67,80)||tag(at,69,88,73,70)||tag(at,88,77,80,32)))return false; // No animation chunks.
        at=end;
      }
      return at===length&&frames===1;
    }
    return false;
  }
  return (value, maxBytes = 32768, requireCanvas = true) => {
    if (!integer(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) return undefined;
    let data, mimeType;
    if (typeof value === "string") {
      // Refuse before regexp allocation. No URL fetching, percent decoding or coercion.
      if (value.length > 4 * ceil(maxBytes / 3) + 32) return undefined;
      const match=exec(url,value);if (!match) return undefined;
      mimeType=match[1];data=match[2];
    } else {
      const block=fields(value,["type","data","mimeType"]);
      if (block?.type === "image") { data=block.data;mimeType=block.mimeType; }
      else {
        const item=fields(value,["image_url"]);
        if (!item || typeof item.image_url !== "string") return undefined;
        // Callers normalize the URL separately without recursive object inspection.
        const text=item.image_url;if (text.length > 4 * ceil(maxBytes / 3) + 32) return undefined;
        const match=exec(url,text);if (!match) return undefined;mimeType=match[1];data=match[2];
      }
    }
    if (typeof data !== "string" || data.length === 0 || data.length % 4 || data.length > 4 * ceil(maxBytes / 3) || !test(base64,data)) return undefined;
    const n=data.length,padding=data[n-2]==="="?2:data[n-1]==="="?1:0,bytes=n/4*3-padding;
    if (bytes > maxBytes || bytes < 3) return undefined;
    // Canonical padding bits; Buffer's permissive base64 decoder alone is insufficient.
    if (padding===2 && (index(alphabet,data[n-3]) & 15) || padding===1 && (index(alphabet,data[n-2]) & 3)) return undefined;
    const prefix=create(null);let count=0,bits=0,acc=0;
    for(let i=0;i<n-padding && count<12;i++) { acc=(acc<<6)|index(alphabet,data[i]);bits+=6;if(bits>=8){bits-=8;prefix[count++]=(acc>>bits)&255;} }
    let actual;
    if(bytes>=8 && prefix[0]===137 && prefix[1]===80 && prefix[2]===78 && prefix[3]===71 && prefix[4]===13 && prefix[5]===10 && prefix[6]===26 && prefix[7]===10) actual="image/png";
    else if(prefix[0]===255 && prefix[1]===216 && prefix[2]===255) actual="image/jpeg";
    else if(bytes>=6 && prefix[0]===71 && prefix[1]===73 && prefix[2]===70 && prefix[3]===56 && (prefix[4]===55 || prefix[4]===57) && prefix[5]===97) actual="image/gif";
    else if(bytes>=12 && prefix[0]===82 && prefix[1]===73 && prefix[2]===70 && prefix[3]===70 && prefix[8]===87 && prefix[9]===69 && prefix[10]===66 && prefix[11]===80) actual="image/webp";
    if (!actual || actual!==mimeType || requireCanvas && !canvas(data,actual,bytes)) return undefined;
    const result=create(null);result.data=data;result.mimeType=actual;result.bytes=bytes;return result;
  };
}
export const imageInput = createImageInput();
// Evaluated as trusted bootstrap inside QuickJS; no native object enters the isolate.
export const IMAGE_INPUT_SOURCE = `(${createImageInput.toString()})()`;
