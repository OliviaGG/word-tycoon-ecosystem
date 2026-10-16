(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function t(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(s){if(s.ep)return;s.ep=!0;const r=t(s);fetch(s.href,r)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Ko="172",Gc=0,xa=1,Wc=2,Wl=1,Xc=2,gn=3,Bn=0,Lt=1,_n=2,Nn=0,Ui=1,Sa=2,Ea=3,Ma=4,qc=5,Qn=100,Yc=101,$c=102,jc=103,Kc=104,Zc=200,Jc=201,Qc=202,eh=203,Jr=204,Qr=205,th=206,nh=207,ih=208,sh=209,rh=210,oh=211,ah=212,lh=213,ch=214,eo=0,to=1,no=2,Bi=3,io=4,so=5,ro=6,oo=7,Xl=0,hh=1,uh=2,Fn=0,dh=1,fh=2,ph=3,mh=4,gh=5,_h=6,vh=7,ql=300,ki=301,zi=302,ao=303,lo=304,sr=306,co=1e3,ni=1001,ho=1002,nn=1003,yh=1004,ys=1005,rn=1006,dr=1007,ii=1008,En=1009,Yl=1010,$l=1011,hs=1012,Zo=1013,li=1014,vn=1015,ds=1016,Jo=1017,Qo=1018,Hi=1020,jl=35902,Kl=1021,Zl=1022,tn=1023,Jl=1024,Ql=1025,Ni=1026,Vi=1027,ec=1028,ea=1029,tc=1030,ta=1031,na=1033,Gs=33776,Ws=33777,Xs=33778,qs=33779,uo=35840,fo=35841,po=35842,mo=35843,go=36196,_o=37492,vo=37496,yo=37808,xo=37809,So=37810,Eo=37811,Mo=37812,bo=37813,wo=37814,To=37815,Ao=37816,Co=37817,Ro=37818,Po=37819,Lo=37820,Do=37821,Ys=36492,Io=36494,Uo=36495,nc=36283,No=36284,Fo=36285,Oo=36286,xh=3200,Sh=3201,Eh=0,Mh=1,In="",qt="srgb",Gi="srgb-linear",tr="linear",Ze="srgb",di=7680,ba=519,bh=512,wh=513,Th=514,ic=515,Ah=516,Ch=517,Rh=518,Ph=519,wa=35044,Ta="300 es",yn=2e3,nr=2001;class Xi{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const s=this._listeners[e];if(s!==void 0){const r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}}const St=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],fr=Math.PI/180,Bo=180/Math.PI;function fs(){const i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(St[i&255]+St[i>>8&255]+St[i>>16&255]+St[i>>24&255]+"-"+St[e&255]+St[e>>8&255]+"-"+St[e>>16&15|64]+St[e>>24&255]+"-"+St[t&63|128]+St[t>>8&255]+"-"+St[t>>16&255]+St[t>>24&255]+St[n&255]+St[n>>8&255]+St[n>>16&255]+St[n>>24&255]).toLowerCase()}function Fe(i,e,t){return Math.max(e,Math.min(t,i))}function Lh(i,e){return(i%e+e)%e}function pr(i,e,t){return(1-t)*i+t*e}function Ki(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Ct(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}class $e{constructor(e=0,t=0){$e.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Fe(this.x,e.x,t.x),this.y=Fe(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Fe(this.x,e,t),this.y=Fe(this.y,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Fe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Fe(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Re{constructor(e,t,n,s,r,o,a,l,c){Re.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c)}set(e,t,n,s,r,o,a,l,c){const d=this.elements;return d[0]=e,d[1]=s,d[2]=a,d[3]=t,d[4]=r,d[5]=l,d[6]=n,d[7]=o,d[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],d=n[4],f=n[7],u=n[2],p=n[5],g=n[8],x=s[0],m=s[3],h=s[6],w=s[1],b=s[4],M=s[7],I=s[2],P=s[5],A=s[8];return r[0]=o*x+a*w+l*I,r[3]=o*m+a*b+l*P,r[6]=o*h+a*M+l*A,r[1]=c*x+d*w+f*I,r[4]=c*m+d*b+f*P,r[7]=c*h+d*M+f*A,r[2]=u*x+p*w+g*I,r[5]=u*m+p*b+g*P,r[8]=u*h+p*M+g*A,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8];return t*o*d-t*a*c-n*r*d+n*a*l+s*r*c-s*o*l}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=d*o-a*c,u=a*l-d*r,p=c*r-o*l,g=t*f+n*u+s*p;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/g;return e[0]=f*x,e[1]=(s*c-d*n)*x,e[2]=(a*n-s*o)*x,e[3]=u*x,e[4]=(d*t-s*l)*x,e[5]=(s*r-a*t)*x,e[6]=p*x,e[7]=(n*l-c*t)*x,e[8]=(o*t-n*r)*x,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+e,-s*c,s*l,-s*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(mr.makeScale(e,t)),this}rotate(e){return this.premultiply(mr.makeRotation(-e)),this}translate(e,t){return this.premultiply(mr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const mr=new Re;function sc(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function ir(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Dh(){const i=ir("canvas");return i.style.display="block",i}const Aa={};function Ri(i){i in Aa||(Aa[i]=!0,console.warn(i))}function Ih(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function Uh(i){const e=i.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function Nh(i){const e=i.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const Ca=new Re().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Ra=new Re().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Fh(){const i={enabled:!0,workingColorSpace:Gi,spaces:{},convert:function(s,r,o){return this.enabled===!1||r===o||!r||!o||(this.spaces[r].transfer===Ze&&(s.r=Sn(s.r),s.g=Sn(s.g),s.b=Sn(s.b)),this.spaces[r].primaries!==this.spaces[o].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===Ze&&(s.r=Fi(s.r),s.g=Fi(s.g),s.b=Fi(s.b))),s},fromWorkingColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},toWorkingColorSpace:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===In?tr:this.spaces[s].transfer},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,o){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Gi]:{primaries:e,whitePoint:n,transfer:tr,toXYZ:Ca,fromXYZ:Ra,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:qt},outputColorSpaceConfig:{drawingBufferColorSpace:qt}},[qt]:{primaries:e,whitePoint:n,transfer:Ze,toXYZ:Ca,fromXYZ:Ra,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:qt}}}),i}const Xe=Fh();function Sn(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Fi(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let fi;class Oh{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{fi===void 0&&(fi=ir("canvas")),fi.width=e.width,fi.height=e.height;const n=fi.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=fi}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=ir("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=Sn(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Sn(t[n]/255)*255):t[n]=Sn(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let Bh=0;class rc{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Bh++}),this.uuid=fs(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(gr(s[o].image)):r.push(gr(s[o]))}else r=gr(s);n.url=r}return t||(e.images[this.uuid]=n),n}}function gr(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Oh.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let kh=0;class Dt extends Xi{constructor(e=Dt.DEFAULT_IMAGE,t=Dt.DEFAULT_MAPPING,n=ni,s=ni,r=rn,o=ii,a=tn,l=En,c=Dt.DEFAULT_ANISOTROPY,d=In){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:kh++}),this.uuid=fs(),this.name="",this.source=new rc(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new $e(0,0),this.repeat=new $e(1,1),this.center=new $e(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Re,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=d,this.userData={},this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==ql)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case co:e.x=e.x-Math.floor(e.x);break;case ni:e.x=e.x<0?0:1;break;case ho:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case co:e.y=e.y-Math.floor(e.y);break;case ni:e.y=e.y<0?0:1;break;case ho:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}Dt.DEFAULT_IMAGE=null;Dt.DEFAULT_MAPPING=ql;Dt.DEFAULT_ANISOTROPY=1;class Qe{constructor(e=0,t=0,n=0,s=1){Qe.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r;const l=e.elements,c=l[0],d=l[4],f=l[8],u=l[1],p=l[5],g=l[9],x=l[2],m=l[6],h=l[10];if(Math.abs(d-u)<.01&&Math.abs(f-x)<.01&&Math.abs(g-m)<.01){if(Math.abs(d+u)<.1&&Math.abs(f+x)<.1&&Math.abs(g+m)<.1&&Math.abs(c+p+h-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const b=(c+1)/2,M=(p+1)/2,I=(h+1)/2,P=(d+u)/4,A=(f+x)/4,U=(g+m)/4;return b>M&&b>I?b<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(b),s=P/n,r=A/n):M>I?M<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(M),n=P/s,r=U/s):I<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(I),n=A/r,s=U/r),this.set(n,s,r,t),this}let w=Math.sqrt((m-g)*(m-g)+(f-x)*(f-x)+(u-d)*(u-d));return Math.abs(w)<.001&&(w=1),this.x=(m-g)/w,this.y=(f-x)/w,this.z=(u-d)/w,this.w=Math.acos((c+p+h-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Fe(this.x,e.x,t.x),this.y=Fe(this.y,e.y,t.y),this.z=Fe(this.z,e.z,t.z),this.w=Fe(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Fe(this.x,e,t),this.y=Fe(this.y,e,t),this.z=Fe(this.z,e,t),this.w=Fe(this.w,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Fe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class zh extends Xi{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new Qe(0,0,e,t),this.scissorTest=!1,this.viewport=new Qe(0,0,e,t);const s={width:e,height:t,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:rn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const r=new Dt(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,s=e.textures.length;n<s;n++)this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;const t=Object.assign({},e.texture.image);return this.texture.source=new rc(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class ci extends zh{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class oc extends Dt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=nn,this.minFilter=nn,this.wrapR=ni,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Hh extends Dt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=nn,this.minFilter=nn,this.wrapR=ni,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class ps{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let l=n[s+0],c=n[s+1],d=n[s+2],f=n[s+3];const u=r[o+0],p=r[o+1],g=r[o+2],x=r[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=d,e[t+3]=f;return}if(a===1){e[t+0]=u,e[t+1]=p,e[t+2]=g,e[t+3]=x;return}if(f!==x||l!==u||c!==p||d!==g){let m=1-a;const h=l*u+c*p+d*g+f*x,w=h>=0?1:-1,b=1-h*h;if(b>Number.EPSILON){const I=Math.sqrt(b),P=Math.atan2(I,h*w);m=Math.sin(m*P)/I,a=Math.sin(a*P)/I}const M=a*w;if(l=l*m+u*M,c=c*m+p*M,d=d*m+g*M,f=f*m+x*M,m===1-a){const I=1/Math.sqrt(l*l+c*c+d*d+f*f);l*=I,c*=I,d*=I,f*=I}}e[t]=l,e[t+1]=c,e[t+2]=d,e[t+3]=f}static multiplyQuaternionsFlat(e,t,n,s,r,o){const a=n[s],l=n[s+1],c=n[s+2],d=n[s+3],f=r[o],u=r[o+1],p=r[o+2],g=r[o+3];return e[t]=a*g+d*f+l*p-c*u,e[t+1]=l*g+d*u+c*f-a*p,e[t+2]=c*g+d*p+a*u-l*f,e[t+3]=d*g-a*f-l*u-c*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(n/2),d=a(s/2),f=a(r/2),u=l(n/2),p=l(s/2),g=l(r/2);switch(o){case"XYZ":this._x=u*d*f+c*p*g,this._y=c*p*f-u*d*g,this._z=c*d*g+u*p*f,this._w=c*d*f-u*p*g;break;case"YXZ":this._x=u*d*f+c*p*g,this._y=c*p*f-u*d*g,this._z=c*d*g-u*p*f,this._w=c*d*f+u*p*g;break;case"ZXY":this._x=u*d*f-c*p*g,this._y=c*p*f+u*d*g,this._z=c*d*g+u*p*f,this._w=c*d*f-u*p*g;break;case"ZYX":this._x=u*d*f-c*p*g,this._y=c*p*f+u*d*g,this._z=c*d*g-u*p*f,this._w=c*d*f+u*p*g;break;case"YZX":this._x=u*d*f+c*p*g,this._y=c*p*f+u*d*g,this._z=c*d*g-u*p*f,this._w=c*d*f-u*p*g;break;case"XZY":this._x=u*d*f-c*p*g,this._y=c*p*f-u*d*g,this._z=c*d*g+u*p*f,this._w=c*d*f+u*p*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],l=t[9],c=t[2],d=t[6],f=t[10],u=n+a+f;if(u>0){const p=.5/Math.sqrt(u+1);this._w=.25/p,this._x=(d-l)*p,this._y=(r-c)*p,this._z=(o-s)*p}else if(n>a&&n>f){const p=2*Math.sqrt(1+n-a-f);this._w=(d-l)/p,this._x=.25*p,this._y=(s+o)/p,this._z=(r+c)/p}else if(a>f){const p=2*Math.sqrt(1+a-n-f);this._w=(r-c)/p,this._x=(s+o)/p,this._y=.25*p,this._z=(l+d)/p}else{const p=2*Math.sqrt(1+f-n-a);this._w=(o-s)/p,this._x=(r+c)/p,this._y=(l+d)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Fe(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,l=t._y,c=t._z,d=t._w;return this._x=n*d+o*a+s*c-r*l,this._y=s*d+o*l+r*a-n*c,this._z=r*d+o*c+n*l-s*a,this._w=o*d-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,s=this._y,r=this._z,o=this._w;let a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;const l=1-a*a;if(l<=Number.EPSILON){const p=1-t;return this._w=p*o+t*this._w,this._x=p*n+t*this._x,this._y=p*s+t*this._y,this._z=p*r+t*this._z,this.normalize(),this}const c=Math.sqrt(l),d=Math.atan2(c,a),f=Math.sin((1-t)*d)/c,u=Math.sin(t*d)/c;return this._w=o*f+this._w*u,this._x=n*f+this._x*u,this._y=s*f+this._y*u,this._z=r*f+this._z*u,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class N{constructor(e=0,t=0,n=0){N.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Pa.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Pa.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){const t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*s-a*n),d=2*(a*t-r*s),f=2*(r*n-o*t);return this.x=t+l*c+o*f-a*d,this.y=n+l*d+a*c-r*f,this.z=s+l*f+r*d-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Fe(this.x,e.x,t.x),this.y=Fe(this.y,e.y,t.y),this.z=Fe(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Fe(this.x,e,t),this.y=Fe(this.y,e,t),this.z=Fe(this.z,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Fe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,l=t.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return _r.copy(this).projectOnVector(e),this.sub(_r)}reflect(e){return this.sub(_r.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Fe(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const _r=new N,Pa=new ps;class ms{constructor(e=new N(1/0,1/0,1/0),t=new N(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Kt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Kt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=Kt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Kt):Kt.fromBufferAttribute(r,o),Kt.applyMatrix4(e.matrixWorld),this.expandByPoint(Kt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),xs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),xs.copy(n.boundingBox)),xs.applyMatrix4(e.matrixWorld),this.union(xs)}const s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Kt),Kt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Zi),Ss.subVectors(this.max,Zi),pi.subVectors(e.a,Zi),mi.subVectors(e.b,Zi),gi.subVectors(e.c,Zi),bn.subVectors(mi,pi),wn.subVectors(gi,mi),Vn.subVectors(pi,gi);let t=[0,-bn.z,bn.y,0,-wn.z,wn.y,0,-Vn.z,Vn.y,bn.z,0,-bn.x,wn.z,0,-wn.x,Vn.z,0,-Vn.x,-bn.y,bn.x,0,-wn.y,wn.x,0,-Vn.y,Vn.x,0];return!vr(t,pi,mi,gi,Ss)||(t=[1,0,0,0,1,0,0,0,1],!vr(t,pi,mi,gi,Ss))?!1:(Es.crossVectors(bn,wn),t=[Es.x,Es.y,Es.z],vr(t,pi,mi,gi,Ss))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Kt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Kt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(hn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),hn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),hn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),hn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),hn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),hn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),hn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),hn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(hn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const hn=[new N,new N,new N,new N,new N,new N,new N,new N],Kt=new N,xs=new ms,pi=new N,mi=new N,gi=new N,bn=new N,wn=new N,Vn=new N,Zi=new N,Ss=new N,Es=new N,Gn=new N;function vr(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){Gn.fromArray(i,r);const a=s.x*Math.abs(Gn.x)+s.y*Math.abs(Gn.y)+s.z*Math.abs(Gn.z),l=e.dot(Gn),c=t.dot(Gn),d=n.dot(Gn);if(Math.max(-Math.max(l,c,d),Math.min(l,c,d))>a)return!1}return!0}const Vh=new ms,Ji=new N,yr=new N;class ia{constructor(e=new N,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Vh.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ji.subVectors(e,this.center);const t=Ji.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Ji,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(yr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ji.copy(e.center).add(yr)),this.expandByPoint(Ji.copy(e.center).sub(yr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const un=new N,xr=new N,Ms=new N,Tn=new N,Sr=new N,bs=new N,Er=new N;class Gh{constructor(e=new N,t=new N(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,un)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=un.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(un.copy(this.origin).addScaledVector(this.direction,t),un.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){xr.copy(e).add(t).multiplyScalar(.5),Ms.copy(t).sub(e).normalize(),Tn.copy(this.origin).sub(xr);const r=e.distanceTo(t)*.5,o=-this.direction.dot(Ms),a=Tn.dot(this.direction),l=-Tn.dot(Ms),c=Tn.lengthSq(),d=Math.abs(1-o*o);let f,u,p,g;if(d>0)if(f=o*l-a,u=o*a-l,g=r*d,f>=0)if(u>=-g)if(u<=g){const x=1/d;f*=x,u*=x,p=f*(f+o*u+2*a)+u*(o*f+u+2*l)+c}else u=r,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;else u=-r,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;else u<=-g?(f=Math.max(0,-(-o*r+a)),u=f>0?-r:Math.min(Math.max(-r,-l),r),p=-f*f+u*(u+2*l)+c):u<=g?(f=0,u=Math.min(Math.max(-r,-l),r),p=u*(u+2*l)+c):(f=Math.max(0,-(o*r+a)),u=f>0?r:Math.min(Math.max(-r,-l),r),p=-f*f+u*(u+2*l)+c);else u=o>0?-r:r,f=Math.max(0,-(o*u+a)),p=-f*f+u*(u+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,f),s&&s.copy(xr).addScaledVector(Ms,u),p}intersectSphere(e,t){un.subVectors(e.center,this.origin);const n=un.dot(this.direction),s=un.dot(un)-n*n,r=e.radius*e.radius;if(s>r)return null;const o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,l;const c=1/this.direction.x,d=1/this.direction.y,f=1/this.direction.z,u=this.origin;return c>=0?(n=(e.min.x-u.x)*c,s=(e.max.x-u.x)*c):(n=(e.max.x-u.x)*c,s=(e.min.x-u.x)*c),d>=0?(r=(e.min.y-u.y)*d,o=(e.max.y-u.y)*d):(r=(e.max.y-u.y)*d,o=(e.min.y-u.y)*d),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),f>=0?(a=(e.min.z-u.z)*f,l=(e.max.z-u.z)*f):(a=(e.max.z-u.z)*f,l=(e.min.z-u.z)*f),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,un)!==null}intersectTriangle(e,t,n,s,r){Sr.subVectors(t,e),bs.subVectors(n,e),Er.crossVectors(Sr,bs);let o=this.direction.dot(Er),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Tn.subVectors(this.origin,e);const l=a*this.direction.dot(bs.crossVectors(Tn,bs));if(l<0)return null;const c=a*this.direction.dot(Sr.cross(Tn));if(c<0||l+c>o)return null;const d=-a*Tn.dot(Er);return d<0?null:this.at(d/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class at{constructor(e,t,n,s,r,o,a,l,c,d,f,u,p,g,x,m){at.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c,d,f,u,p,g,x,m)}set(e,t,n,s,r,o,a,l,c,d,f,u,p,g,x,m){const h=this.elements;return h[0]=e,h[4]=t,h[8]=n,h[12]=s,h[1]=r,h[5]=o,h[9]=a,h[13]=l,h[2]=c,h[6]=d,h[10]=f,h[14]=u,h[3]=p,h[7]=g,h[11]=x,h[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new at().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,s=1/_i.setFromMatrixColumn(e,0).length(),r=1/_i.setFromMatrixColumn(e,1).length(),o=1/_i.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),d=Math.cos(r),f=Math.sin(r);if(e.order==="XYZ"){const u=o*d,p=o*f,g=a*d,x=a*f;t[0]=l*d,t[4]=-l*f,t[8]=c,t[1]=p+g*c,t[5]=u-x*c,t[9]=-a*l,t[2]=x-u*c,t[6]=g+p*c,t[10]=o*l}else if(e.order==="YXZ"){const u=l*d,p=l*f,g=c*d,x=c*f;t[0]=u+x*a,t[4]=g*a-p,t[8]=o*c,t[1]=o*f,t[5]=o*d,t[9]=-a,t[2]=p*a-g,t[6]=x+u*a,t[10]=o*l}else if(e.order==="ZXY"){const u=l*d,p=l*f,g=c*d,x=c*f;t[0]=u-x*a,t[4]=-o*f,t[8]=g+p*a,t[1]=p+g*a,t[5]=o*d,t[9]=x-u*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){const u=o*d,p=o*f,g=a*d,x=a*f;t[0]=l*d,t[4]=g*c-p,t[8]=u*c+x,t[1]=l*f,t[5]=x*c+u,t[9]=p*c-g,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){const u=o*l,p=o*c,g=a*l,x=a*c;t[0]=l*d,t[4]=x-u*f,t[8]=g*f+p,t[1]=f,t[5]=o*d,t[9]=-a*d,t[2]=-c*d,t[6]=p*f+g,t[10]=u-x*f}else if(e.order==="XZY"){const u=o*l,p=o*c,g=a*l,x=a*c;t[0]=l*d,t[4]=-f,t[8]=c*d,t[1]=u*f+x,t[5]=o*d,t[9]=p*f-g,t[2]=g*f-p,t[6]=a*d,t[10]=x*f+u}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Wh,e,Xh)}lookAt(e,t,n){const s=this.elements;return Nt.subVectors(e,t),Nt.lengthSq()===0&&(Nt.z=1),Nt.normalize(),An.crossVectors(n,Nt),An.lengthSq()===0&&(Math.abs(n.z)===1?Nt.x+=1e-4:Nt.z+=1e-4,Nt.normalize(),An.crossVectors(n,Nt)),An.normalize(),ws.crossVectors(Nt,An),s[0]=An.x,s[4]=ws.x,s[8]=Nt.x,s[1]=An.y,s[5]=ws.y,s[9]=Nt.y,s[2]=An.z,s[6]=ws.z,s[10]=Nt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],d=n[1],f=n[5],u=n[9],p=n[13],g=n[2],x=n[6],m=n[10],h=n[14],w=n[3],b=n[7],M=n[11],I=n[15],P=s[0],A=s[4],U=s[8],S=s[12],y=s[1],C=s[5],G=s[9],k=s[13],$=s[2],j=s[6],X=s[10],Z=s[14],H=s[3],se=s[7],he=s[11],ve=s[15];return r[0]=o*P+a*y+l*$+c*H,r[4]=o*A+a*C+l*j+c*se,r[8]=o*U+a*G+l*X+c*he,r[12]=o*S+a*k+l*Z+c*ve,r[1]=d*P+f*y+u*$+p*H,r[5]=d*A+f*C+u*j+p*se,r[9]=d*U+f*G+u*X+p*he,r[13]=d*S+f*k+u*Z+p*ve,r[2]=g*P+x*y+m*$+h*H,r[6]=g*A+x*C+m*j+h*se,r[10]=g*U+x*G+m*X+h*he,r[14]=g*S+x*k+m*Z+h*ve,r[3]=w*P+b*y+M*$+I*H,r[7]=w*A+b*C+M*j+I*se,r[11]=w*U+b*G+M*X+I*he,r[15]=w*S+b*k+M*Z+I*ve,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],l=e[9],c=e[13],d=e[2],f=e[6],u=e[10],p=e[14],g=e[3],x=e[7],m=e[11],h=e[15];return g*(+r*l*f-s*c*f-r*a*u+n*c*u+s*a*p-n*l*p)+x*(+t*l*p-t*c*u+r*o*u-s*o*p+s*c*d-r*l*d)+m*(+t*c*f-t*a*p-r*o*f+n*o*p+r*a*d-n*c*d)+h*(-s*a*d-t*l*f+t*a*u+s*o*f-n*o*u+n*l*d)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],d=e[8],f=e[9],u=e[10],p=e[11],g=e[12],x=e[13],m=e[14],h=e[15],w=f*m*c-x*u*c+x*l*p-a*m*p-f*l*h+a*u*h,b=g*u*c-d*m*c-g*l*p+o*m*p+d*l*h-o*u*h,M=d*x*c-g*f*c+g*a*p-o*x*p-d*a*h+o*f*h,I=g*f*l-d*x*l-g*a*u+o*x*u+d*a*m-o*f*m,P=t*w+n*b+s*M+r*I;if(P===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const A=1/P;return e[0]=w*A,e[1]=(x*u*r-f*m*r-x*s*p+n*m*p+f*s*h-n*u*h)*A,e[2]=(a*m*r-x*l*r+x*s*c-n*m*c-a*s*h+n*l*h)*A,e[3]=(f*l*r-a*u*r-f*s*c+n*u*c+a*s*p-n*l*p)*A,e[4]=b*A,e[5]=(d*m*r-g*u*r+g*s*p-t*m*p-d*s*h+t*u*h)*A,e[6]=(g*l*r-o*m*r-g*s*c+t*m*c+o*s*h-t*l*h)*A,e[7]=(o*u*r-d*l*r+d*s*c-t*u*c-o*s*p+t*l*p)*A,e[8]=M*A,e[9]=(g*f*r-d*x*r-g*n*p+t*x*p+d*n*h-t*f*h)*A,e[10]=(o*x*r-g*a*r+g*n*c-t*x*c-o*n*h+t*a*h)*A,e[11]=(d*a*r-o*f*r-d*n*c+t*f*c+o*n*p-t*a*p)*A,e[12]=I*A,e[13]=(d*x*s-g*f*s+g*n*u-t*x*u-d*n*m+t*f*m)*A,e[14]=(g*a*s-o*x*s-g*n*l+t*x*l+o*n*m-t*a*m)*A,e[15]=(o*f*s-d*a*s+d*n*l-t*f*l-o*n*u+t*a*u)*A,this}scale(e){const t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,l=e.z,c=r*o,d=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,d*a+n,d*l-s*o,0,c*l-s*a,d*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){const s=this.elements,r=t._x,o=t._y,a=t._z,l=t._w,c=r+r,d=o+o,f=a+a,u=r*c,p=r*d,g=r*f,x=o*d,m=o*f,h=a*f,w=l*c,b=l*d,M=l*f,I=n.x,P=n.y,A=n.z;return s[0]=(1-(x+h))*I,s[1]=(p+M)*I,s[2]=(g-b)*I,s[3]=0,s[4]=(p-M)*P,s[5]=(1-(u+h))*P,s[6]=(m+w)*P,s[7]=0,s[8]=(g+b)*A,s[9]=(m-w)*A,s[10]=(1-(u+x))*A,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){const s=this.elements;let r=_i.set(s[0],s[1],s[2]).length();const o=_i.set(s[4],s[5],s[6]).length(),a=_i.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],Zt.copy(this);const c=1/r,d=1/o,f=1/a;return Zt.elements[0]*=c,Zt.elements[1]*=c,Zt.elements[2]*=c,Zt.elements[4]*=d,Zt.elements[5]*=d,Zt.elements[6]*=d,Zt.elements[8]*=f,Zt.elements[9]*=f,Zt.elements[10]*=f,t.setFromRotationMatrix(Zt),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=yn){const l=this.elements,c=2*r/(t-e),d=2*r/(n-s),f=(t+e)/(t-e),u=(n+s)/(n-s);let p,g;if(a===yn)p=-(o+r)/(o-r),g=-2*o*r/(o-r);else if(a===nr)p=-o/(o-r),g=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=f,l[12]=0,l[1]=0,l[5]=d,l[9]=u,l[13]=0,l[2]=0,l[6]=0,l[10]=p,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=yn){const l=this.elements,c=1/(t-e),d=1/(n-s),f=1/(o-r),u=(t+e)*c,p=(n+s)*d;let g,x;if(a===yn)g=(o+r)*f,x=-2*f;else if(a===nr)g=r*f,x=-1*f;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-u,l[1]=0,l[5]=2*d,l[9]=0,l[13]=-p,l[2]=0,l[6]=0,l[10]=x,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const _i=new N,Zt=new at,Wh=new N(0,0,0),Xh=new N(1,1,1),An=new N,ws=new N,Nt=new N,La=new at,Da=new ps;class Mn{constructor(e=0,t=0,n=0,s=Mn.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const s=e.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],d=s[9],f=s[2],u=s[6],p=s[10];switch(t){case"XYZ":this._y=Math.asin(Fe(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-d,p),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(u,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Fe(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,r),this._z=0);break;case"ZXY":this._x=Math.asin(Fe(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-f,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Fe(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(u,p),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Fe(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-d,c),this._y=Math.atan2(-f,r)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Fe(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(u,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-d,p),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return La.makeRotationFromQuaternion(e),this.setFromRotationMatrix(La,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Da.setFromEuler(this),this.setFromQuaternion(Da,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Mn.DEFAULT_ORDER="XYZ";class ac{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let qh=0;const Ia=new N,vi=new ps,dn=new at,Ts=new N,Qi=new N,Yh=new N,$h=new ps,Ua=new N(1,0,0),Na=new N(0,1,0),Fa=new N(0,0,1),Oa={type:"added"},jh={type:"removed"},yi={type:"childadded",child:null},Mr={type:"childremoved",child:null};class It extends Xi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:qh++}),this.uuid=fs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=It.DEFAULT_UP.clone();const e=new N,t=new Mn,n=new ps,s=new N(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new at},normalMatrix:{value:new Re}}),this.matrix=new at,this.matrixWorld=new at,this.matrixAutoUpdate=It.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=It.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ac,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return vi.setFromAxisAngle(e,t),this.quaternion.multiply(vi),this}rotateOnWorldAxis(e,t){return vi.setFromAxisAngle(e,t),this.quaternion.premultiply(vi),this}rotateX(e){return this.rotateOnAxis(Ua,e)}rotateY(e){return this.rotateOnAxis(Na,e)}rotateZ(e){return this.rotateOnAxis(Fa,e)}translateOnAxis(e,t){return Ia.copy(e).applyQuaternion(this.quaternion),this.position.add(Ia.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Ua,e)}translateY(e){return this.translateOnAxis(Na,e)}translateZ(e){return this.translateOnAxis(Fa,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(dn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Ts.copy(e):Ts.set(e,t,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Qi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?dn.lookAt(Qi,Ts,this.up):dn.lookAt(Ts,Qi,this.up),this.quaternion.setFromRotationMatrix(dn),s&&(dn.extractRotation(s.matrixWorld),vi.setFromRotationMatrix(dn),this.quaternion.premultiply(vi.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Oa),yi.child=e,this.dispatchEvent(yi),yi.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(jh),Mr.child=e,this.dispatchEvent(Mr),Mr.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),dn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),dn.multiply(e.parent.matrixWorld)),e.applyMatrix4(dn),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Oa),yi.child=e,this.dispatchEvent(yi),yi.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){const o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Qi,e,Yh),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Qi,$h,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,d=l.length;c<d;c++){const f=l[c];r(e.shapes,f)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(e.materials,this.material[l]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];s.animations.push(r(e.animations,l))}}if(t){const a=o(e.geometries),l=o(e.materials),c=o(e.textures),d=o(e.images),f=o(e.shapes),u=o(e.skeletons),p=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),d.length>0&&(n.images=d),f.length>0&&(n.shapes=f),u.length>0&&(n.skeletons=u),p.length>0&&(n.animations=p),g.length>0&&(n.nodes=g)}return n.object=s,n;function o(a){const l=[];for(const c in a){const d=a[c];delete d.metadata,l.push(d)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const s=e.children[n];this.add(s.clone())}return this}}It.DEFAULT_UP=new N(0,1,0);It.DEFAULT_MATRIX_AUTO_UPDATE=!0;It.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Jt=new N,fn=new N,br=new N,pn=new N,xi=new N,Si=new N,Ba=new N,wr=new N,Tr=new N,Ar=new N,Cr=new Qe,Rr=new Qe,Pr=new Qe;class en{constructor(e=new N,t=new N,n=new N){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),Jt.subVectors(e,t),s.cross(Jt);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){Jt.subVectors(s,t),fn.subVectors(n,t),br.subVectors(e,t);const o=Jt.dot(Jt),a=Jt.dot(fn),l=Jt.dot(br),c=fn.dot(fn),d=fn.dot(br),f=o*c-a*a;if(f===0)return r.set(0,0,0),null;const u=1/f,p=(c*l-a*d)*u,g=(o*d-a*l)*u;return r.set(1-p-g,g,p)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,pn)===null?!1:pn.x>=0&&pn.y>=0&&pn.x+pn.y<=1}static getInterpolation(e,t,n,s,r,o,a,l){return this.getBarycoord(e,t,n,s,pn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,pn.x),l.addScaledVector(o,pn.y),l.addScaledVector(a,pn.z),l)}static getInterpolatedAttribute(e,t,n,s,r,o){return Cr.setScalar(0),Rr.setScalar(0),Pr.setScalar(0),Cr.fromBufferAttribute(e,t),Rr.fromBufferAttribute(e,n),Pr.fromBufferAttribute(e,s),o.setScalar(0),o.addScaledVector(Cr,r.x),o.addScaledVector(Rr,r.y),o.addScaledVector(Pr,r.z),o}static isFrontFacing(e,t,n,s){return Jt.subVectors(n,t),fn.subVectors(e,t),Jt.cross(fn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Jt.subVectors(this.c,this.b),fn.subVectors(this.a,this.b),Jt.cross(fn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return en.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return en.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return en.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return en.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return en.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,s=this.b,r=this.c;let o,a;xi.subVectors(s,n),Si.subVectors(r,n),wr.subVectors(e,n);const l=xi.dot(wr),c=Si.dot(wr);if(l<=0&&c<=0)return t.copy(n);Tr.subVectors(e,s);const d=xi.dot(Tr),f=Si.dot(Tr);if(d>=0&&f<=d)return t.copy(s);const u=l*f-d*c;if(u<=0&&l>=0&&d<=0)return o=l/(l-d),t.copy(n).addScaledVector(xi,o);Ar.subVectors(e,r);const p=xi.dot(Ar),g=Si.dot(Ar);if(g>=0&&p<=g)return t.copy(r);const x=p*c-l*g;if(x<=0&&c>=0&&g<=0)return a=c/(c-g),t.copy(n).addScaledVector(Si,a);const m=d*g-p*f;if(m<=0&&f-d>=0&&p-g>=0)return Ba.subVectors(r,s),a=(f-d)/(f-d+(p-g)),t.copy(s).addScaledVector(Ba,a);const h=1/(m+x+u);return o=x*h,a=u*h,t.copy(n).addScaledVector(xi,o).addScaledVector(Si,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const lc={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Cn={h:0,s:0,l:0},As={h:0,s:0,l:0};function Lr(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}class Ke{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=qt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Xe.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=Xe.workingColorSpace){return this.r=e,this.g=t,this.b=n,Xe.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=Xe.workingColorSpace){if(e=Lh(e,1),t=Fe(t,0,1),n=Fe(n,0,1),t===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=Lr(o,r,e+1/3),this.g=Lr(o,r,e),this.b=Lr(o,r,e-1/3)}return Xe.toWorkingColorSpace(this,s),this}setStyle(e,t=qt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r;const o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){const r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=qt){const n=lc[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Sn(e.r),this.g=Sn(e.g),this.b=Sn(e.b),this}copyLinearToSRGB(e){return this.r=Fi(e.r),this.g=Fi(e.g),this.b=Fi(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=qt){return Xe.fromWorkingColorSpace(Et.copy(this),e),Math.round(Fe(Et.r*255,0,255))*65536+Math.round(Fe(Et.g*255,0,255))*256+Math.round(Fe(Et.b*255,0,255))}getHexString(e=qt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Xe.workingColorSpace){Xe.fromWorkingColorSpace(Et.copy(this),t);const n=Et.r,s=Et.g,r=Et.b,o=Math.max(n,s,r),a=Math.min(n,s,r);let l,c;const d=(a+o)/2;if(a===o)l=0,c=0;else{const f=o-a;switch(c=d<=.5?f/(o+a):f/(2-o-a),o){case n:l=(s-r)/f+(s<r?6:0);break;case s:l=(r-n)/f+2;break;case r:l=(n-s)/f+4;break}l/=6}return e.h=l,e.s=c,e.l=d,e}getRGB(e,t=Xe.workingColorSpace){return Xe.fromWorkingColorSpace(Et.copy(this),t),e.r=Et.r,e.g=Et.g,e.b=Et.b,e}getStyle(e=qt){Xe.fromWorkingColorSpace(Et.copy(this),e);const t=Et.r,n=Et.g,s=Et.b;return e!==qt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Cn),this.setHSL(Cn.h+e,Cn.s+t,Cn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Cn),e.getHSL(As);const n=pr(Cn.h,As.h,t),s=pr(Cn.s,As.s,t),r=pr(Cn.l,As.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Et=new Ke;Ke.NAMES=lc;let Kh=0;class rr extends Xi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Kh++}),this.uuid=fs(),this.name="",this.type="Material",this.blending=Ui,this.side=Bn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Jr,this.blendDst=Qr,this.blendEquation=Qn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ke(0,0,0),this.blendAlpha=0,this.depthFunc=Bi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=ba,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=di,this.stencilZFail=di,this.stencilZPass=di,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Ui&&(n.blending=this.blending),this.side!==Bn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Jr&&(n.blendSrc=this.blendSrc),this.blendDst!==Qr&&(n.blendDst=this.blendDst),this.blendEquation!==Qn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Bi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==ba&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==di&&(n.stencilFail=this.stencilFail),this.stencilZFail!==di&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==di&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const o=[];for(const a in r){const l=r[a];delete l.metadata,o.push(l)}return o}if(t){const r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class cc extends rr{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ke(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Mn,this.combine=Xl,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const ft=new N,Cs=new $e;class on{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=wa,this.updateRanges=[],this.gpuType=vn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Cs.fromBufferAttribute(this,t),Cs.applyMatrix3(e),this.setXY(t,Cs.x,Cs.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)ft.fromBufferAttribute(this,t),ft.applyMatrix3(e),this.setXYZ(t,ft.x,ft.y,ft.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)ft.fromBufferAttribute(this,t),ft.applyMatrix4(e),this.setXYZ(t,ft.x,ft.y,ft.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)ft.fromBufferAttribute(this,t),ft.applyNormalMatrix(e),this.setXYZ(t,ft.x,ft.y,ft.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)ft.fromBufferAttribute(this,t),ft.transformDirection(e),this.setXYZ(t,ft.x,ft.y,ft.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Ki(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Ct(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ki(t,this.array)),t}setX(e,t){return this.normalized&&(t=Ct(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ki(t,this.array)),t}setY(e,t){return this.normalized&&(t=Ct(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ki(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Ct(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ki(t,this.array)),t}setW(e,t){return this.normalized&&(t=Ct(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Ct(t,this.array),n=Ct(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Ct(t,this.array),n=Ct(n,this.array),s=Ct(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Ct(t,this.array),n=Ct(n,this.array),s=Ct(s,this.array),r=Ct(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==wa&&(e.usage=this.usage),e}}class hc extends on{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class uc extends on{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class ai extends on{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Zh=0;const Gt=new at,Dr=new It,Ei=new N,Ft=new ms,es=new ms,_t=new N;class hi extends Xi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Zh++}),this.uuid=fs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(sc(e)?uc:hc)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Re().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Gt.makeRotationFromQuaternion(e),this.applyMatrix4(Gt),this}rotateX(e){return Gt.makeRotationX(e),this.applyMatrix4(Gt),this}rotateY(e){return Gt.makeRotationY(e),this.applyMatrix4(Gt),this}rotateZ(e){return Gt.makeRotationZ(e),this.applyMatrix4(Gt),this}translate(e,t,n){return Gt.makeTranslation(e,t,n),this.applyMatrix4(Gt),this}scale(e,t,n){return Gt.makeScale(e,t,n),this.applyMatrix4(Gt),this}lookAt(e){return Dr.lookAt(e),Dr.updateMatrix(),this.applyMatrix4(Dr.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ei).negate(),this.translate(Ei.x,Ei.y,Ei.z),this}setFromPoints(e){const t=this.getAttribute("position");if(t===void 0){const n=[];for(let s=0,r=e.length;s<r;s++){const o=e[s];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new ai(n,3))}else{const n=Math.min(e.length,t.count);for(let s=0;s<n;s++){const r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ms);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new N(-1/0,-1/0,-1/0),new N(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){const r=t[n];Ft.setFromBufferAttribute(r),this.morphTargetsRelative?(_t.addVectors(this.boundingBox.min,Ft.min),this.boundingBox.expandByPoint(_t),_t.addVectors(this.boundingBox.max,Ft.max),this.boundingBox.expandByPoint(_t)):(this.boundingBox.expandByPoint(Ft.min),this.boundingBox.expandByPoint(Ft.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ia);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new N,1/0);return}if(e){const n=this.boundingSphere.center;if(Ft.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){const a=t[r];es.setFromBufferAttribute(a),this.morphTargetsRelative?(_t.addVectors(Ft.min,es.min),Ft.expandByPoint(_t),_t.addVectors(Ft.max,es.max),Ft.expandByPoint(_t)):(Ft.expandByPoint(es.min),Ft.expandByPoint(es.max))}Ft.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)_t.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(_t));if(t)for(let r=0,o=t.length;r<o;r++){const a=t[r],l=this.morphTargetsRelative;for(let c=0,d=a.count;c<d;c++)_t.fromBufferAttribute(a,c),l&&(Ei.fromBufferAttribute(e,c),_t.add(Ei)),s=Math.max(s,n.distanceToSquared(_t))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new on(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],l=[];for(let U=0;U<n.count;U++)a[U]=new N,l[U]=new N;const c=new N,d=new N,f=new N,u=new $e,p=new $e,g=new $e,x=new N,m=new N;function h(U,S,y){c.fromBufferAttribute(n,U),d.fromBufferAttribute(n,S),f.fromBufferAttribute(n,y),u.fromBufferAttribute(r,U),p.fromBufferAttribute(r,S),g.fromBufferAttribute(r,y),d.sub(c),f.sub(c),p.sub(u),g.sub(u);const C=1/(p.x*g.y-g.x*p.y);isFinite(C)&&(x.copy(d).multiplyScalar(g.y).addScaledVector(f,-p.y).multiplyScalar(C),m.copy(f).multiplyScalar(p.x).addScaledVector(d,-g.x).multiplyScalar(C),a[U].add(x),a[S].add(x),a[y].add(x),l[U].add(m),l[S].add(m),l[y].add(m))}let w=this.groups;w.length===0&&(w=[{start:0,count:e.count}]);for(let U=0,S=w.length;U<S;++U){const y=w[U],C=y.start,G=y.count;for(let k=C,$=C+G;k<$;k+=3)h(e.getX(k+0),e.getX(k+1),e.getX(k+2))}const b=new N,M=new N,I=new N,P=new N;function A(U){I.fromBufferAttribute(s,U),P.copy(I);const S=a[U];b.copy(S),b.sub(I.multiplyScalar(I.dot(S))).normalize(),M.crossVectors(P,S);const C=M.dot(l[U])<0?-1:1;o.setXYZW(U,b.x,b.y,b.z,C)}for(let U=0,S=w.length;U<S;++U){const y=w[U],C=y.start,G=y.count;for(let k=C,$=C+G;k<$;k+=3)A(e.getX(k+0)),A(e.getX(k+1)),A(e.getX(k+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new on(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let u=0,p=n.count;u<p;u++)n.setXYZ(u,0,0,0);const s=new N,r=new N,o=new N,a=new N,l=new N,c=new N,d=new N,f=new N;if(e)for(let u=0,p=e.count;u<p;u+=3){const g=e.getX(u+0),x=e.getX(u+1),m=e.getX(u+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,x),o.fromBufferAttribute(t,m),d.subVectors(o,r),f.subVectors(s,r),d.cross(f),a.fromBufferAttribute(n,g),l.fromBufferAttribute(n,x),c.fromBufferAttribute(n,m),a.add(d),l.add(d),c.add(d),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(x,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let u=0,p=t.count;u<p;u+=3)s.fromBufferAttribute(t,u+0),r.fromBufferAttribute(t,u+1),o.fromBufferAttribute(t,u+2),d.subVectors(o,r),f.subVectors(s,r),d.cross(f),n.setXYZ(u+0,d.x,d.y,d.z),n.setXYZ(u+1,d.x,d.y,d.z),n.setXYZ(u+2,d.x,d.y,d.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)_t.fromBufferAttribute(e,t),_t.normalize(),e.setXYZ(t,_t.x,_t.y,_t.z)}toNonIndexed(){function e(a,l){const c=a.array,d=a.itemSize,f=a.normalized,u=new c.constructor(l.length*d);let p=0,g=0;for(let x=0,m=l.length;x<m;x++){a.isInterleavedBufferAttribute?p=l[x]*a.data.stride+a.offset:p=l[x]*d;for(let h=0;h<d;h++)u[g++]=c[p++]}return new on(u,d,f)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new hi,n=this.index.array,s=this.attributes;for(const a in s){const l=s[a],c=e(l,n);t.setAttribute(a,c)}const r=this.morphAttributes;for(const a in r){const l=[],c=r[a];for(let d=0,f=c.length;d<f;d++){const u=c[d],p=e(u,n);l.push(p)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const l in n){const c=n[l];e.data.attributes[l]=c.toJSON(e.data)}const s={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],d=[];for(let f=0,u=c.length;f<u;f++){const p=c[f];d.push(p.toJSON(e.data))}d.length>0&&(s[l]=d,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const s=e.attributes;for(const c in s){const d=s[c];this.setAttribute(c,d.clone(t))}const r=e.morphAttributes;for(const c in r){const d=[],f=r[c];for(let u=0,p=f.length;u<p;u++)d.push(f[u].clone(t));this.morphAttributes[c]=d}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let c=0,d=o.length;c<d;c++){const f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const ka=new at,Wn=new Gh,Rs=new ia,za=new N,Ps=new N,Ls=new N,Ds=new N,Ir=new N,Is=new N,Ha=new N,Us=new N;class xn extends It{constructor(e=new hi,t=new cc){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);const a=this.morphTargetInfluences;if(r&&a){Is.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const d=a[l],f=r[l];d!==0&&(Ir.fromBufferAttribute(f,e),o?Is.addScaledVector(Ir,d):Is.addScaledVector(Ir.sub(t),d))}t.add(Is)}return t}raycast(e,t){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Rs.copy(n.boundingSphere),Rs.applyMatrix4(r),Wn.copy(e.ray).recast(e.near),!(Rs.containsPoint(Wn.origin)===!1&&(Wn.intersectSphere(Rs,za)===null||Wn.origin.distanceToSquared(za)>(e.far-e.near)**2))&&(ka.copy(r).invert(),Wn.copy(e.ray).applyMatrix4(ka),!(n.boundingBox!==null&&Wn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Wn)))}_computeIntersections(e,t,n){let s;const r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,d=r.attributes.uv1,f=r.attributes.normal,u=r.groups,p=r.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,x=u.length;g<x;g++){const m=u[g],h=o[m.materialIndex],w=Math.max(m.start,p.start),b=Math.min(a.count,Math.min(m.start+m.count,p.start+p.count));for(let M=w,I=b;M<I;M+=3){const P=a.getX(M),A=a.getX(M+1),U=a.getX(M+2);s=Ns(this,h,e,n,c,d,f,P,A,U),s&&(s.faceIndex=Math.floor(M/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{const g=Math.max(0,p.start),x=Math.min(a.count,p.start+p.count);for(let m=g,h=x;m<h;m+=3){const w=a.getX(m),b=a.getX(m+1),M=a.getX(m+2);s=Ns(this,o,e,n,c,d,f,w,b,M),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,x=u.length;g<x;g++){const m=u[g],h=o[m.materialIndex],w=Math.max(m.start,p.start),b=Math.min(l.count,Math.min(m.start+m.count,p.start+p.count));for(let M=w,I=b;M<I;M+=3){const P=M,A=M+1,U=M+2;s=Ns(this,h,e,n,c,d,f,P,A,U),s&&(s.faceIndex=Math.floor(M/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{const g=Math.max(0,p.start),x=Math.min(l.count,p.start+p.count);for(let m=g,h=x;m<h;m+=3){const w=m,b=m+1,M=m+2;s=Ns(this,o,e,n,c,d,f,w,b,M),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}}}function Jh(i,e,t,n,s,r,o,a){let l;if(e.side===Lt?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,e.side===Bn,a),l===null)return null;Us.copy(a),Us.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(Us);return c<t.near||c>t.far?null:{distance:c,point:Us.clone(),object:i}}function Ns(i,e,t,n,s,r,o,a,l,c){i.getVertexPosition(a,Ps),i.getVertexPosition(l,Ls),i.getVertexPosition(c,Ds);const d=Jh(i,e,t,n,Ps,Ls,Ds,Ha);if(d){const f=new N;en.getBarycoord(Ha,Ps,Ls,Ds,f),s&&(d.uv=en.getInterpolatedAttribute(s,a,l,c,f,new $e)),r&&(d.uv1=en.getInterpolatedAttribute(r,a,l,c,f,new $e)),o&&(d.normal=en.getInterpolatedAttribute(o,a,l,c,f,new N),d.normal.dot(n.direction)>0&&d.normal.multiplyScalar(-1));const u={a,b:l,c,normal:new N,materialIndex:0};en.getNormal(Ps,Ls,Ds,u.normal),d.face=u,d.barycoord=f}return d}class gs extends hi{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};const a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);const l=[],c=[],d=[],f=[];let u=0,p=0;g("z","y","x",-1,-1,n,t,e,o,r,0),g("z","y","x",1,-1,n,t,-e,o,r,1),g("x","z","y",1,1,e,n,t,s,o,2),g("x","z","y",1,-1,e,n,-t,s,o,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new ai(c,3)),this.setAttribute("normal",new ai(d,3)),this.setAttribute("uv",new ai(f,2));function g(x,m,h,w,b,M,I,P,A,U,S){const y=M/A,C=I/U,G=M/2,k=I/2,$=P/2,j=A+1,X=U+1;let Z=0,H=0;const se=new N;for(let he=0;he<X;he++){const ve=he*C-k;for(let Ie=0;Ie<j;Ie++){const et=Ie*y-G;se[x]=et*w,se[m]=ve*b,se[h]=$,c.push(se.x,se.y,se.z),se[x]=0,se[m]=0,se[h]=P>0?1:-1,d.push(se.x,se.y,se.z),f.push(Ie/A),f.push(1-he/U),Z+=1}}for(let he=0;he<U;he++)for(let ve=0;ve<A;ve++){const Ie=u+ve+j*he,et=u+ve+j*(he+1),W=u+(ve+1)+j*(he+1),ee=u+(ve+1)+j*he;l.push(Ie,et,ee),l.push(et,W,ee),H+=6}a.addGroup(p,H,S),p+=H,u+=Z}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new gs(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Wi(i){const e={};for(const t in i){e[t]={};for(const n in i[t]){const s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function bt(i){const e={};for(let t=0;t<i.length;t++){const n=Wi(i[t]);for(const s in n)e[s]=n[s]}return e}function Qh(i){const e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function dc(i){const e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Xe.workingColorSpace}const eu={clone:Wi,merge:bt};var tu=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,nu=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class kn extends rr{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=tu,this.fragmentShader=nu,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Wi(e.uniforms),this.uniformsGroups=Qh(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const s in this.uniforms){const o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class fc extends It{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new at,this.projectionMatrix=new at,this.projectionMatrixInverse=new at,this.coordinateSystem=yn}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Rn=new N,Va=new $e,Ga=new $e;class Bt extends fc{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Bo*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(fr*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Bo*2*Math.atan(Math.tan(fr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Rn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Rn.x,Rn.y).multiplyScalar(-e/Rn.z),Rn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Rn.x,Rn.y).multiplyScalar(-e/Rn.z)}getViewSize(e,t){return this.getViewBounds(e,Va,Ga),t.subVectors(Ga,Va)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(fr*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,t-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}const a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const Mi=-90,bi=1;class iu extends It{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new Bt(Mi,bi,e,t);s.layers=this.layers,this.add(s);const r=new Bt(Mi,bi,e,t);r.layers=this.layers,this.add(r);const o=new Bt(Mi,bi,e,t);o.layers=this.layers,this.add(o);const a=new Bt(Mi,bi,e,t);a.layers=this.layers,this.add(a);const l=new Bt(Mi,bi,e,t);l.layers=this.layers,this.add(l);const c=new Bt(Mi,bi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,l]=t;for(const c of t)this.remove(c);if(e===yn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===nr)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,l,c,d]=this.children,f=e.getRenderTarget(),u=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;const x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=x,e.setRenderTarget(n,5,s),e.render(t,d),e.setRenderTarget(f,u,p),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class pc extends Dt{constructor(e,t,n,s,r,o,a,l,c,d){e=e!==void 0?e:[],t=t!==void 0?t:ki,super(e,t,n,s,r,o,a,l,c,d),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class su extends ci{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new pc(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:rn}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new gs(5,5,5),r=new kn({name:"CubemapFromEquirect",uniforms:Wi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Lt,blending:Nn});r.uniforms.tEquirect.value=t;const o=new xn(s,r),a=t.minFilter;return t.minFilter===ii&&(t.minFilter=rn),new iu(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,s){const r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}}class ru extends It{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Mn,this.environmentIntensity=1,this.environmentRotation=new Mn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}const Ur=new N,ou=new N,au=new Re;class Kn{constructor(e=new N(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const s=Ur.subVectors(n,t).cross(ou.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(Ur),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||au.getNormalMatrix(e),s=this.coplanarPoint(Ur).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Xn=new ia,Fs=new N;class sa{constructor(e=new Kn,t=new Kn,n=new Kn,s=new Kn,r=new Kn,o=new Kn){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=yn){const n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],l=s[3],c=s[4],d=s[5],f=s[6],u=s[7],p=s[8],g=s[9],x=s[10],m=s[11],h=s[12],w=s[13],b=s[14],M=s[15];if(n[0].setComponents(l-r,u-c,m-p,M-h).normalize(),n[1].setComponents(l+r,u+c,m+p,M+h).normalize(),n[2].setComponents(l+o,u+d,m+g,M+w).normalize(),n[3].setComponents(l-o,u-d,m-g,M-w).normalize(),n[4].setComponents(l-a,u-f,m-x,M-b).normalize(),t===yn)n[5].setComponents(l+a,u+f,m+x,M+b).normalize();else if(t===nr)n[5].setComponents(a,f,x,b).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Xn.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Xn.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Xn)}intersectsSprite(e){return Xn.center.set(0,0,0),Xn.radius=.7071067811865476,Xn.applyMatrix4(e.matrixWorld),this.intersectsSphere(Xn)}intersectsSphere(e){const t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const s=t[n];if(Fs.x=s.normal.x>0?e.max.x:e.min.x,Fs.y=s.normal.y>0?e.max.y:e.min.y,Fs.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Fs)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class Os extends It{constructor(){super(),this.isGroup=!0,this.type="Group"}}class mc extends Dt{constructor(e,t,n,s,r,o,a,l,c,d=Ni){if(d!==Ni&&d!==Vi)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&d===Ni&&(n=li),n===void 0&&d===Vi&&(n=Hi),super(null,s,r,o,a,l,d,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:nn,this.minFilter=l!==void 0?l:nn,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}class or extends hi{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};const r=e/2,o=t/2,a=Math.floor(n),l=Math.floor(s),c=a+1,d=l+1,f=e/a,u=t/l,p=[],g=[],x=[],m=[];for(let h=0;h<d;h++){const w=h*u-o;for(let b=0;b<c;b++){const M=b*f-r;g.push(M,-w,0),x.push(0,0,1),m.push(b/a),m.push(1-h/l)}}for(let h=0;h<l;h++)for(let w=0;w<a;w++){const b=w+c*h,M=w+c*(h+1),I=w+1+c*(h+1),P=w+1+c*h;p.push(b,M,P),p.push(M,I,P)}this.setIndex(p),this.setAttribute("position",new ai(g,3)),this.setAttribute("normal",new ai(x,3)),this.setAttribute("uv",new ai(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new or(e.width,e.height,e.widthSegments,e.heightSegments)}}class lu extends rr{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=xh,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class cu extends rr{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}class gc extends It{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ke(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}const Nr=new at,Wa=new N,Xa=new N;class hu{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new $e(512,512),this.map=null,this.mapPass=null,this.matrix=new at,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new sa,this._frameExtents=new $e(1,1),this._viewportCount=1,this._viewports=[new Qe(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;Wa.setFromMatrixPosition(e.matrixWorld),t.position.copy(Wa),Xa.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Xa),t.updateMatrixWorld(),Nr.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Nr),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Nr)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}const qa=new at,ts=new N,Fr=new N;class uu extends hu{constructor(){super(new Bt(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new $e(4,2),this._viewportCount=6,this._viewports=[new Qe(2,1,1,1),new Qe(0,1,1,1),new Qe(3,1,1,1),new Qe(1,1,1,1),new Qe(3,0,1,1),new Qe(1,0,1,1)],this._cubeDirections=[new N(1,0,0),new N(-1,0,0),new N(0,0,1),new N(0,0,-1),new N(0,1,0),new N(0,-1,0)],this._cubeUps=[new N(0,1,0),new N(0,1,0),new N(0,1,0),new N(0,1,0),new N(0,0,1),new N(0,0,-1)]}updateMatrices(e,t=0){const n=this.camera,s=this.matrix,r=e.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),ts.setFromMatrixPosition(e.matrixWorld),n.position.copy(ts),Fr.copy(n.position),Fr.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(Fr),n.updateMatrixWorld(),s.makeTranslation(-ts.x,-ts.y,-ts.z),qa.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(qa)}}class Ya extends gc{constructor(e,t,n=0,s=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=s,this.shadow=new uu}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}}class du extends fc{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-e,o=n+e,a=s+t,l=s-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,d=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=d*this.view.offsetY,l=a-d*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}class fu extends gc{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}class pu extends Bt{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}function $a(i,e,t,n){const s=mu(n);switch(t){case Kl:return i*e;case Jl:return i*e;case Ql:return i*e*2;case ec:return i*e/s.components*s.byteLength;case ea:return i*e/s.components*s.byteLength;case tc:return i*e*2/s.components*s.byteLength;case ta:return i*e*2/s.components*s.byteLength;case Zl:return i*e*3/s.components*s.byteLength;case tn:return i*e*4/s.components*s.byteLength;case na:return i*e*4/s.components*s.byteLength;case Gs:case Ws:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Xs:case qs:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case fo:case mo:return Math.max(i,16)*Math.max(e,8)/4;case uo:case po:return Math.max(i,8)*Math.max(e,8)/2;case go:case _o:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case vo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case yo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case xo:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case So:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case Eo:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case Mo:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case bo:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case wo:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case To:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case Ao:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case Co:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case Ro:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case Po:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case Lo:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case Do:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Ys:case Io:case Uo:return Math.ceil(i/4)*Math.ceil(e/4)*16;case nc:case No:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Fo:case Oo:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function mu(i){switch(i){case En:case Yl:return{byteLength:1,components:1};case hs:case $l:case ds:return{byteLength:2,components:1};case Jo:case Qo:return{byteLength:2,components:4};case li:case Zo:case vn:return{byteLength:4,components:1};case jl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Ko}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Ko);/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function _c(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function gu(i){const e=new WeakMap;function t(a,l){const c=a.array,d=a.usage,f=c.byteLength,u=i.createBuffer();i.bindBuffer(l,u),i.bufferData(l,c,d),a.onUploadCallback();let p;if(c instanceof Float32Array)p=i.FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=i.HALF_FLOAT:p=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=i.SHORT;else if(c instanceof Uint32Array)p=i.UNSIGNED_INT;else if(c instanceof Int32Array)p=i.INT;else if(c instanceof Int8Array)p=i.BYTE;else if(c instanceof Uint8Array)p=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:u,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:f}}function n(a,l,c){const d=l.array,f=l.updateRanges;if(i.bindBuffer(c,a),f.length===0)i.bufferSubData(c,0,d);else{f.sort((p,g)=>p.start-g.start);let u=0;for(let p=1;p<f.length;p++){const g=f[u],x=f[p];x.start<=g.start+g.count+1?g.count=Math.max(g.count,x.start+x.count-g.start):(++u,f[u]=x)}f.length=u+1;for(let p=0,g=f.length;p<g;p++){const x=f[p];i.bufferSubData(c,x.start*d.BYTES_PER_ELEMENT,d,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);const l=e.get(a);l&&(i.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const d=e.get(a);(!d||d.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const c=e.get(a);if(c===void 0)e.set(a,t(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,a,l),c.version=a.version}}return{get:s,remove:r,update:o}}var _u=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,vu=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,yu=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,xu=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Su=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Eu=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Mu=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,bu=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,wu=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Tu=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Au=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Cu=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Ru=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Pu=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Lu=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Du=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Iu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Uu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Nu=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Fu=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,Ou=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Bu=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,ku=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,zu=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Hu=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Vu=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Gu=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Wu=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Xu=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,qu=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Yu="gl_FragColor = linearToOutputTexel( gl_FragColor );",$u=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,ju=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Ku=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Zu=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Ju=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Qu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,ed=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,td=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,nd=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,id=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,sd=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,rd=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,od=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,ad=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,ld=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,cd=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,hd=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,ud=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,dd=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,fd=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,pd=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,md=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,gd=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,_d=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,vd=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,yd=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,xd=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Sd=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Ed=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Md=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,bd=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,wd=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Td=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Ad=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Cd=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Rd=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Pd=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Ld=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Dd=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Id=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Ud=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Nd=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Fd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Od=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Bd=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,kd=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,zd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Hd=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Vd=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Gd=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Wd=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Xd=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,qd=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Yd=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,$d=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,jd=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Kd=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Zd=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Jd=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Qd=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,ef=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,tf=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,nf=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,sf=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,rf=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,of=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,af=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,lf=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,cf=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,hf=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,uf=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,df=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,ff=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,pf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,mf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,gf=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const _f=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,vf=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,yf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,xf=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Sf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Ef=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Mf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,bf=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,wf=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Tf=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Af=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Cf=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Rf=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Pf=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Lf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Df=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,If=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Uf=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Nf=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Ff=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Of=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Bf=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,kf=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,zf=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Hf=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Vf=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Gf=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Wf=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Xf=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,qf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Yf=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,$f=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,jf=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Kf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,De={alphahash_fragment:_u,alphahash_pars_fragment:vu,alphamap_fragment:yu,alphamap_pars_fragment:xu,alphatest_fragment:Su,alphatest_pars_fragment:Eu,aomap_fragment:Mu,aomap_pars_fragment:bu,batching_pars_vertex:wu,batching_vertex:Tu,begin_vertex:Au,beginnormal_vertex:Cu,bsdfs:Ru,iridescence_fragment:Pu,bumpmap_pars_fragment:Lu,clipping_planes_fragment:Du,clipping_planes_pars_fragment:Iu,clipping_planes_pars_vertex:Uu,clipping_planes_vertex:Nu,color_fragment:Fu,color_pars_fragment:Ou,color_pars_vertex:Bu,color_vertex:ku,common:zu,cube_uv_reflection_fragment:Hu,defaultnormal_vertex:Vu,displacementmap_pars_vertex:Gu,displacementmap_vertex:Wu,emissivemap_fragment:Xu,emissivemap_pars_fragment:qu,colorspace_fragment:Yu,colorspace_pars_fragment:$u,envmap_fragment:ju,envmap_common_pars_fragment:Ku,envmap_pars_fragment:Zu,envmap_pars_vertex:Ju,envmap_physical_pars_fragment:cd,envmap_vertex:Qu,fog_vertex:ed,fog_pars_vertex:td,fog_fragment:nd,fog_pars_fragment:id,gradientmap_pars_fragment:sd,lightmap_pars_fragment:rd,lights_lambert_fragment:od,lights_lambert_pars_fragment:ad,lights_pars_begin:ld,lights_toon_fragment:hd,lights_toon_pars_fragment:ud,lights_phong_fragment:dd,lights_phong_pars_fragment:fd,lights_physical_fragment:pd,lights_physical_pars_fragment:md,lights_fragment_begin:gd,lights_fragment_maps:_d,lights_fragment_end:vd,logdepthbuf_fragment:yd,logdepthbuf_pars_fragment:xd,logdepthbuf_pars_vertex:Sd,logdepthbuf_vertex:Ed,map_fragment:Md,map_pars_fragment:bd,map_particle_fragment:wd,map_particle_pars_fragment:Td,metalnessmap_fragment:Ad,metalnessmap_pars_fragment:Cd,morphinstance_vertex:Rd,morphcolor_vertex:Pd,morphnormal_vertex:Ld,morphtarget_pars_vertex:Dd,morphtarget_vertex:Id,normal_fragment_begin:Ud,normal_fragment_maps:Nd,normal_pars_fragment:Fd,normal_pars_vertex:Od,normal_vertex:Bd,normalmap_pars_fragment:kd,clearcoat_normal_fragment_begin:zd,clearcoat_normal_fragment_maps:Hd,clearcoat_pars_fragment:Vd,iridescence_pars_fragment:Gd,opaque_fragment:Wd,packing:Xd,premultiplied_alpha_fragment:qd,project_vertex:Yd,dithering_fragment:$d,dithering_pars_fragment:jd,roughnessmap_fragment:Kd,roughnessmap_pars_fragment:Zd,shadowmap_pars_fragment:Jd,shadowmap_pars_vertex:Qd,shadowmap_vertex:ef,shadowmask_pars_fragment:tf,skinbase_vertex:nf,skinning_pars_vertex:sf,skinning_vertex:rf,skinnormal_vertex:of,specularmap_fragment:af,specularmap_pars_fragment:lf,tonemapping_fragment:cf,tonemapping_pars_fragment:hf,transmission_fragment:uf,transmission_pars_fragment:df,uv_pars_fragment:ff,uv_pars_vertex:pf,uv_vertex:mf,worldpos_vertex:gf,background_vert:_f,background_frag:vf,backgroundCube_vert:yf,backgroundCube_frag:xf,cube_vert:Sf,cube_frag:Ef,depth_vert:Mf,depth_frag:bf,distanceRGBA_vert:wf,distanceRGBA_frag:Tf,equirect_vert:Af,equirect_frag:Cf,linedashed_vert:Rf,linedashed_frag:Pf,meshbasic_vert:Lf,meshbasic_frag:Df,meshlambert_vert:If,meshlambert_frag:Uf,meshmatcap_vert:Nf,meshmatcap_frag:Ff,meshnormal_vert:Of,meshnormal_frag:Bf,meshphong_vert:kf,meshphong_frag:zf,meshphysical_vert:Hf,meshphysical_frag:Vf,meshtoon_vert:Gf,meshtoon_frag:Wf,points_vert:Xf,points_frag:qf,shadow_vert:Yf,shadow_frag:$f,sprite_vert:jf,sprite_frag:Kf},te={common:{diffuse:{value:new Ke(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Re},alphaMap:{value:null},alphaMapTransform:{value:new Re},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Re}},envmap:{envMap:{value:null},envMapRotation:{value:new Re},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Re}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Re}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Re},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Re},normalScale:{value:new $e(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Re},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Re}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Re}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Re}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ke(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ke(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Re},alphaTest:{value:0},uvTransform:{value:new Re}},sprite:{diffuse:{value:new Ke(16777215)},opacity:{value:1},center:{value:new $e(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Re},alphaMap:{value:null},alphaMapTransform:{value:new Re},alphaTest:{value:0}}},sn={basic:{uniforms:bt([te.common,te.specularmap,te.envmap,te.aomap,te.lightmap,te.fog]),vertexShader:De.meshbasic_vert,fragmentShader:De.meshbasic_frag},lambert:{uniforms:bt([te.common,te.specularmap,te.envmap,te.aomap,te.lightmap,te.emissivemap,te.bumpmap,te.normalmap,te.displacementmap,te.fog,te.lights,{emissive:{value:new Ke(0)}}]),vertexShader:De.meshlambert_vert,fragmentShader:De.meshlambert_frag},phong:{uniforms:bt([te.common,te.specularmap,te.envmap,te.aomap,te.lightmap,te.emissivemap,te.bumpmap,te.normalmap,te.displacementmap,te.fog,te.lights,{emissive:{value:new Ke(0)},specular:{value:new Ke(1118481)},shininess:{value:30}}]),vertexShader:De.meshphong_vert,fragmentShader:De.meshphong_frag},standard:{uniforms:bt([te.common,te.envmap,te.aomap,te.lightmap,te.emissivemap,te.bumpmap,te.normalmap,te.displacementmap,te.roughnessmap,te.metalnessmap,te.fog,te.lights,{emissive:{value:new Ke(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:De.meshphysical_vert,fragmentShader:De.meshphysical_frag},toon:{uniforms:bt([te.common,te.aomap,te.lightmap,te.emissivemap,te.bumpmap,te.normalmap,te.displacementmap,te.gradientmap,te.fog,te.lights,{emissive:{value:new Ke(0)}}]),vertexShader:De.meshtoon_vert,fragmentShader:De.meshtoon_frag},matcap:{uniforms:bt([te.common,te.bumpmap,te.normalmap,te.displacementmap,te.fog,{matcap:{value:null}}]),vertexShader:De.meshmatcap_vert,fragmentShader:De.meshmatcap_frag},points:{uniforms:bt([te.points,te.fog]),vertexShader:De.points_vert,fragmentShader:De.points_frag},dashed:{uniforms:bt([te.common,te.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:De.linedashed_vert,fragmentShader:De.linedashed_frag},depth:{uniforms:bt([te.common,te.displacementmap]),vertexShader:De.depth_vert,fragmentShader:De.depth_frag},normal:{uniforms:bt([te.common,te.bumpmap,te.normalmap,te.displacementmap,{opacity:{value:1}}]),vertexShader:De.meshnormal_vert,fragmentShader:De.meshnormal_frag},sprite:{uniforms:bt([te.sprite,te.fog]),vertexShader:De.sprite_vert,fragmentShader:De.sprite_frag},background:{uniforms:{uvTransform:{value:new Re},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:De.background_vert,fragmentShader:De.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Re}},vertexShader:De.backgroundCube_vert,fragmentShader:De.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:De.cube_vert,fragmentShader:De.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:De.equirect_vert,fragmentShader:De.equirect_frag},distanceRGBA:{uniforms:bt([te.common,te.displacementmap,{referencePosition:{value:new N},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:De.distanceRGBA_vert,fragmentShader:De.distanceRGBA_frag},shadow:{uniforms:bt([te.lights,te.fog,{color:{value:new Ke(0)},opacity:{value:1}}]),vertexShader:De.shadow_vert,fragmentShader:De.shadow_frag}};sn.physical={uniforms:bt([sn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Re},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Re},clearcoatNormalScale:{value:new $e(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Re},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Re},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Re},sheen:{value:0},sheenColor:{value:new Ke(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Re},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Re},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Re},transmissionSamplerSize:{value:new $e},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Re},attenuationDistance:{value:0},attenuationColor:{value:new Ke(0)},specularColor:{value:new Ke(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Re},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Re},anisotropyVector:{value:new $e},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Re}}]),vertexShader:De.meshphysical_vert,fragmentShader:De.meshphysical_frag};const Bs={r:0,b:0,g:0},qn=new Mn,Zf=new at;function Jf(i,e,t,n,s,r,o){const a=new Ke(0);let l=r===!0?0:1,c,d,f=null,u=0,p=null;function g(b){let M=b.isScene===!0?b.background:null;return M&&M.isTexture&&(M=(b.backgroundBlurriness>0?t:e).get(M)),M}function x(b){let M=!1;const I=g(b);I===null?h(a,l):I&&I.isColor&&(h(I,1),M=!0);const P=i.xr.getEnvironmentBlendMode();P==="additive"?n.buffers.color.setClear(0,0,0,1,o):P==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||M)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function m(b,M){const I=g(M);I&&(I.isCubeTexture||I.mapping===sr)?(d===void 0&&(d=new xn(new gs(1,1,1),new kn({name:"BackgroundCubeMaterial",uniforms:Wi(sn.backgroundCube.uniforms),vertexShader:sn.backgroundCube.vertexShader,fragmentShader:sn.backgroundCube.fragmentShader,side:Lt,depthTest:!1,depthWrite:!1,fog:!1})),d.geometry.deleteAttribute("normal"),d.geometry.deleteAttribute("uv"),d.onBeforeRender=function(P,A,U){this.matrixWorld.copyPosition(U.matrixWorld)},Object.defineProperty(d.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(d)),qn.copy(M.backgroundRotation),qn.x*=-1,qn.y*=-1,qn.z*=-1,I.isCubeTexture&&I.isRenderTargetTexture===!1&&(qn.y*=-1,qn.z*=-1),d.material.uniforms.envMap.value=I,d.material.uniforms.flipEnvMap.value=I.isCubeTexture&&I.isRenderTargetTexture===!1?-1:1,d.material.uniforms.backgroundBlurriness.value=M.backgroundBlurriness,d.material.uniforms.backgroundIntensity.value=M.backgroundIntensity,d.material.uniforms.backgroundRotation.value.setFromMatrix4(Zf.makeRotationFromEuler(qn)),d.material.toneMapped=Xe.getTransfer(I.colorSpace)!==Ze,(f!==I||u!==I.version||p!==i.toneMapping)&&(d.material.needsUpdate=!0,f=I,u=I.version,p=i.toneMapping),d.layers.enableAll(),b.unshift(d,d.geometry,d.material,0,0,null)):I&&I.isTexture&&(c===void 0&&(c=new xn(new or(2,2),new kn({name:"BackgroundMaterial",uniforms:Wi(sn.background.uniforms),vertexShader:sn.background.vertexShader,fragmentShader:sn.background.fragmentShader,side:Bn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=I,c.material.uniforms.backgroundIntensity.value=M.backgroundIntensity,c.material.toneMapped=Xe.getTransfer(I.colorSpace)!==Ze,I.matrixAutoUpdate===!0&&I.updateMatrix(),c.material.uniforms.uvTransform.value.copy(I.matrix),(f!==I||u!==I.version||p!==i.toneMapping)&&(c.material.needsUpdate=!0,f=I,u=I.version,p=i.toneMapping),c.layers.enableAll(),b.unshift(c,c.geometry,c.material,0,0,null))}function h(b,M){b.getRGB(Bs,dc(i)),n.buffers.color.setClear(Bs.r,Bs.g,Bs.b,M,o)}function w(){d!==void 0&&(d.geometry.dispose(),d.material.dispose()),c!==void 0&&(c.geometry.dispose(),c.material.dispose())}return{getClearColor:function(){return a},setClearColor:function(b,M=1){a.set(b),l=M,h(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(b){l=b,h(a,l)},render:x,addToRenderList:m,dispose:w}}function Qf(i,e){const t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=u(null);let r=s,o=!1;function a(y,C,G,k,$){let j=!1;const X=f(k,G,C);r!==X&&(r=X,c(r.object)),j=p(y,k,G,$),j&&g(y,k,G,$),$!==null&&e.update($,i.ELEMENT_ARRAY_BUFFER),(j||o)&&(o=!1,M(y,C,G,k),$!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get($).buffer))}function l(){return i.createVertexArray()}function c(y){return i.bindVertexArray(y)}function d(y){return i.deleteVertexArray(y)}function f(y,C,G){const k=G.wireframe===!0;let $=n[y.id];$===void 0&&($={},n[y.id]=$);let j=$[C.id];j===void 0&&(j={},$[C.id]=j);let X=j[k];return X===void 0&&(X=u(l()),j[k]=X),X}function u(y){const C=[],G=[],k=[];for(let $=0;$<t;$++)C[$]=0,G[$]=0,k[$]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:C,enabledAttributes:G,attributeDivisors:k,object:y,attributes:{},index:null}}function p(y,C,G,k){const $=r.attributes,j=C.attributes;let X=0;const Z=G.getAttributes();for(const H in Z)if(Z[H].location>=0){const he=$[H];let ve=j[H];if(ve===void 0&&(H==="instanceMatrix"&&y.instanceMatrix&&(ve=y.instanceMatrix),H==="instanceColor"&&y.instanceColor&&(ve=y.instanceColor)),he===void 0||he.attribute!==ve||ve&&he.data!==ve.data)return!0;X++}return r.attributesNum!==X||r.index!==k}function g(y,C,G,k){const $={},j=C.attributes;let X=0;const Z=G.getAttributes();for(const H in Z)if(Z[H].location>=0){let he=j[H];he===void 0&&(H==="instanceMatrix"&&y.instanceMatrix&&(he=y.instanceMatrix),H==="instanceColor"&&y.instanceColor&&(he=y.instanceColor));const ve={};ve.attribute=he,he&&he.data&&(ve.data=he.data),$[H]=ve,X++}r.attributes=$,r.attributesNum=X,r.index=k}function x(){const y=r.newAttributes;for(let C=0,G=y.length;C<G;C++)y[C]=0}function m(y){h(y,0)}function h(y,C){const G=r.newAttributes,k=r.enabledAttributes,$=r.attributeDivisors;G[y]=1,k[y]===0&&(i.enableVertexAttribArray(y),k[y]=1),$[y]!==C&&(i.vertexAttribDivisor(y,C),$[y]=C)}function w(){const y=r.newAttributes,C=r.enabledAttributes;for(let G=0,k=C.length;G<k;G++)C[G]!==y[G]&&(i.disableVertexAttribArray(G),C[G]=0)}function b(y,C,G,k,$,j,X){X===!0?i.vertexAttribIPointer(y,C,G,$,j):i.vertexAttribPointer(y,C,G,k,$,j)}function M(y,C,G,k){x();const $=k.attributes,j=G.getAttributes(),X=C.defaultAttributeValues;for(const Z in j){const H=j[Z];if(H.location>=0){let se=$[Z];if(se===void 0&&(Z==="instanceMatrix"&&y.instanceMatrix&&(se=y.instanceMatrix),Z==="instanceColor"&&y.instanceColor&&(se=y.instanceColor)),se!==void 0){const he=se.normalized,ve=se.itemSize,Ie=e.get(se);if(Ie===void 0)continue;const et=Ie.buffer,W=Ie.type,ee=Ie.bytesPerElement,me=W===i.INT||W===i.UNSIGNED_INT||se.gpuType===Zo;if(se.isInterleavedBufferAttribute){const re=se.data,Me=re.stride,Te=se.offset;if(re.isInstancedInterleavedBuffer){for(let Ue=0;Ue<H.locationSize;Ue++)h(H.location+Ue,re.meshPerAttribute);y.isInstancedMesh!==!0&&k._maxInstanceCount===void 0&&(k._maxInstanceCount=re.meshPerAttribute*re.count)}else for(let Ue=0;Ue<H.locationSize;Ue++)m(H.location+Ue);i.bindBuffer(i.ARRAY_BUFFER,et);for(let Ue=0;Ue<H.locationSize;Ue++)b(H.location+Ue,ve/H.locationSize,W,he,Me*ee,(Te+ve/H.locationSize*Ue)*ee,me)}else{if(se.isInstancedBufferAttribute){for(let re=0;re<H.locationSize;re++)h(H.location+re,se.meshPerAttribute);y.isInstancedMesh!==!0&&k._maxInstanceCount===void 0&&(k._maxInstanceCount=se.meshPerAttribute*se.count)}else for(let re=0;re<H.locationSize;re++)m(H.location+re);i.bindBuffer(i.ARRAY_BUFFER,et);for(let re=0;re<H.locationSize;re++)b(H.location+re,ve/H.locationSize,W,he,ve*ee,ve/H.locationSize*re*ee,me)}}else if(X!==void 0){const he=X[Z];if(he!==void 0)switch(he.length){case 2:i.vertexAttrib2fv(H.location,he);break;case 3:i.vertexAttrib3fv(H.location,he);break;case 4:i.vertexAttrib4fv(H.location,he);break;default:i.vertexAttrib1fv(H.location,he)}}}}w()}function I(){U();for(const y in n){const C=n[y];for(const G in C){const k=C[G];for(const $ in k)d(k[$].object),delete k[$];delete C[G]}delete n[y]}}function P(y){if(n[y.id]===void 0)return;const C=n[y.id];for(const G in C){const k=C[G];for(const $ in k)d(k[$].object),delete k[$];delete C[G]}delete n[y.id]}function A(y){for(const C in n){const G=n[C];if(G[y.id]===void 0)continue;const k=G[y.id];for(const $ in k)d(k[$].object),delete k[$];delete G[y.id]}}function U(){S(),o=!0,r!==s&&(r=s,c(r.object))}function S(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:a,reset:U,resetDefaultState:S,dispose:I,releaseStatesOfGeometry:P,releaseStatesOfProgram:A,initAttributes:x,enableAttribute:m,disableUnusedAttributes:w}}function ep(i,e,t){let n;function s(c){n=c}function r(c,d){i.drawArrays(n,c,d),t.update(d,n,1)}function o(c,d,f){f!==0&&(i.drawArraysInstanced(n,c,d,f),t.update(d,n,f))}function a(c,d,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,d,0,f);let p=0;for(let g=0;g<f;g++)p+=d[g];t.update(p,n,1)}function l(c,d,f,u){if(f===0)return;const p=e.get("WEBGL_multi_draw");if(p===null)for(let g=0;g<c.length;g++)o(c[g],d[g],u[g]);else{p.multiDrawArraysInstancedWEBGL(n,c,0,d,0,u,0,f);let g=0;for(let x=0;x<f;x++)g+=d[x]*u[x];t.update(g,n,1)}}this.setMode=s,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function tp(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){const A=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function o(A){return!(A!==tn&&n.convert(A)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(A){const U=A===ds&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(A!==En&&n.convert(A)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==vn&&!U)}function l(A){if(A==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp";const d=l(c);d!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",d,"instead."),c=d);const f=t.logarithmicDepthBuffer===!0,u=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control"),p=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),h=i.getParameter(i.MAX_VERTEX_ATTRIBS),w=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),b=i.getParameter(i.MAX_VARYING_VECTORS),M=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),I=g>0,P=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:f,reverseDepthBuffer:u,maxTextures:p,maxVertexTextures:g,maxTextureSize:x,maxCubemapSize:m,maxAttributes:h,maxVertexUniforms:w,maxVaryings:b,maxFragmentUniforms:M,vertexTextures:I,maxSamples:P}}function np(i){const e=this;let t=null,n=0,s=!1,r=!1;const o=new Kn,a=new Re,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,u){const p=f.length!==0||u||n!==0||s;return s=u,n=f.length,p},this.beginShadows=function(){r=!0,d(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(f,u){t=d(f,u,0)},this.setState=function(f,u,p){const g=f.clippingPlanes,x=f.clipIntersection,m=f.clipShadows,h=i.get(f);if(!s||g===null||g.length===0||r&&!m)r?d(null):c();else{const w=r?0:n,b=w*4;let M=h.clippingState||null;l.value=M,M=d(g,u,b,p);for(let I=0;I!==b;++I)M[I]=t[I];h.clippingState=M,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=w}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function d(f,u,p,g){const x=f!==null?f.length:0;let m=null;if(x!==0){if(m=l.value,g!==!0||m===null){const h=p+x*4,w=u.matrixWorldInverse;a.getNormalMatrix(w),(m===null||m.length<h)&&(m=new Float32Array(h));for(let b=0,M=p;b!==x;++b,M+=4)o.copy(f[b]).applyMatrix4(w,a),o.normal.toArray(m,M),m[M+3]=o.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=x,e.numIntersection=0,m}}function ip(i){let e=new WeakMap;function t(o,a){return a===ao?o.mapping=ki:a===lo&&(o.mapping=zi),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===ao||a===lo)if(e.has(o)){const l=e.get(o).texture;return t(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new su(l.height);return c.fromEquirectangularTexture(i,o),e.set(o,c),o.addEventListener("dispose",s),t(c.texture,o.mapping)}else return null}}return o}function s(o){const a=o.target;a.removeEventListener("dispose",s);const l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}const Pi=4,ja=[.125,.215,.35,.446,.526,.582],ei=20,Or=new du,Ka=new Ke;let Br=null,kr=0,zr=0,Hr=!1;const Zn=(1+Math.sqrt(5))/2,wi=1/Zn,Za=[new N(-Zn,wi,0),new N(Zn,wi,0),new N(-wi,0,Zn),new N(wi,0,Zn),new N(0,Zn,-wi),new N(0,Zn,wi),new N(-1,1,-1),new N(1,1,-1),new N(-1,1,1),new N(1,1,1)];class Ja{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){Br=this._renderer.getRenderTarget(),kr=this._renderer.getActiveCubeFace(),zr=this._renderer.getActiveMipmapLevel(),Hr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=tl(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=el(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Br,kr,zr),this._renderer.xr.enabled=Hr,e.scissorTest=!1,ks(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===ki||e.mapping===zi?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Br=this._renderer.getRenderTarget(),kr=this._renderer.getActiveCubeFace(),zr=this._renderer.getActiveMipmapLevel(),Hr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:rn,minFilter:rn,generateMipmaps:!1,type:ds,format:tn,colorSpace:Gi,depthBuffer:!1},s=Qa(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Qa(e,t,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=sp(r)),this._blurMaterial=rp(r,e,t)}return s}_compileMaterial(e){const t=new xn(this._lodPlanes[0],e);this._renderer.compile(t,Or)}_sceneToCubeUV(e,t,n,s){const a=new Bt(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],d=this._renderer,f=d.autoClear,u=d.toneMapping;d.getClearColor(Ka),d.toneMapping=Fn,d.autoClear=!1;const p=new cc({name:"PMREM.Background",side:Lt,depthWrite:!1,depthTest:!1}),g=new xn(new gs,p);let x=!1;const m=e.background;m?m.isColor&&(p.color.copy(m),e.background=null,x=!0):(p.color.copy(Ka),x=!0);for(let h=0;h<6;h++){const w=h%3;w===0?(a.up.set(0,l[h],0),a.lookAt(c[h],0,0)):w===1?(a.up.set(0,0,l[h]),a.lookAt(0,c[h],0)):(a.up.set(0,l[h],0),a.lookAt(0,0,c[h]));const b=this._cubeSize;ks(s,w*b,h>2?b:0,b,b),d.setRenderTarget(s),x&&d.render(g,a),d.render(e,a)}g.geometry.dispose(),g.material.dispose(),d.toneMapping=u,d.autoClear=f,e.background=m}_textureToCubeUV(e,t){const n=this._renderer,s=e.mapping===ki||e.mapping===zi;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=tl()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=el());const r=s?this._cubemapMaterial:this._equirectMaterial,o=new xn(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;const l=this._cubeSize;ks(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(o,Or)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const s=this._lodPlanes.length;for(let r=1;r<s;r++){const o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=Za[(s-r-1)%Za.length];this._blur(e,r-1,r,o,a)}t.autoClear=n}_blur(e,t,n,s,r){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const d=3,f=new xn(this._lodPlanes[s],c),u=c.uniforms,p=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*p):2*Math.PI/(2*ei-1),x=r/g,m=isFinite(r)?1+Math.floor(d*x):ei;m>ei&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${ei}`);const h=[];let w=0;for(let A=0;A<ei;++A){const U=A/x,S=Math.exp(-U*U/2);h.push(S),A===0?w+=S:A<m&&(w+=2*S)}for(let A=0;A<h.length;A++)h[A]=h[A]/w;u.envMap.value=e.texture,u.samples.value=m,u.weights.value=h,u.latitudinal.value=o==="latitudinal",a&&(u.poleAxis.value=a);const{_lodMax:b}=this;u.dTheta.value=g,u.mipInt.value=b-n;const M=this._sizeLods[s],I=3*M*(s>b-Pi?s-b+Pi:0),P=4*(this._cubeSize-M);ks(t,I,P,3*M,2*M),l.setRenderTarget(t),l.render(f,Or)}}function sp(i){const e=[],t=[],n=[];let s=i;const r=i-Pi+1+ja.length;for(let o=0;o<r;o++){const a=Math.pow(2,s);t.push(a);let l=1/a;o>i-Pi?l=ja[o-i+Pi-1]:o===0&&(l=0),n.push(l);const c=1/(a-2),d=-c,f=1+c,u=[d,d,f,d,f,f,d,d,f,f,d,f],p=6,g=6,x=3,m=2,h=1,w=new Float32Array(x*g*p),b=new Float32Array(m*g*p),M=new Float32Array(h*g*p);for(let P=0;P<p;P++){const A=P%3*2/3-1,U=P>2?0:-1,S=[A,U,0,A+2/3,U,0,A+2/3,U+1,0,A,U,0,A+2/3,U+1,0,A,U+1,0];w.set(S,x*g*P),b.set(u,m*g*P);const y=[P,P,P,P,P,P];M.set(y,h*g*P)}const I=new hi;I.setAttribute("position",new on(w,x)),I.setAttribute("uv",new on(b,m)),I.setAttribute("faceIndex",new on(M,h)),e.push(I),s>Pi&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Qa(i,e,t){const n=new ci(i,e,t);return n.texture.mapping=sr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function ks(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function rp(i,e,t){const n=new Float32Array(ei),s=new N(0,1,0);return new kn({name:"SphericalGaussianBlur",defines:{n:ei,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:ra(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Nn,depthTest:!1,depthWrite:!1})}function el(){return new kn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:ra(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Nn,depthTest:!1,depthWrite:!1})}function tl(){return new kn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:ra(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Nn,depthTest:!1,depthWrite:!1})}function ra(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function op(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){const l=a.mapping,c=l===ao||l===lo,d=l===ki||l===zi;if(c||d){let f=e.get(a);const u=f!==void 0?f.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==u)return t===null&&(t=new Ja(i)),f=c?t.fromEquirectangular(a,f):t.fromCubemap(a,f),f.texture.pmremVersion=a.pmremVersion,e.set(a,f),f.texture;if(f!==void 0)return f.texture;{const p=a.image;return c&&p&&p.height>0||d&&p&&s(p)?(t===null&&(t=new Ja(i)),f=c?t.fromEquirectangular(a):t.fromCubemap(a),f.texture.pmremVersion=a.pmremVersion,e.set(a,f),a.addEventListener("dispose",r),f.texture):null}}}return a}function s(a){let l=0;const c=6;for(let d=0;d<c;d++)a[d]!==void 0&&l++;return l===c}function r(a){const l=a.target;l.removeEventListener("dispose",r);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function ap(i){const e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const s=t(n);return s===null&&Ri("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function lp(i,e,t,n){const s={},r=new WeakMap;function o(f){const u=f.target;u.index!==null&&e.remove(u.index);for(const g in u.attributes)e.remove(u.attributes[g]);u.removeEventListener("dispose",o),delete s[u.id];const p=r.get(u);p&&(e.remove(p),r.delete(u)),n.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,t.memory.geometries--}function a(f,u){return s[u.id]===!0||(u.addEventListener("dispose",o),s[u.id]=!0,t.memory.geometries++),u}function l(f){const u=f.attributes;for(const p in u)e.update(u[p],i.ARRAY_BUFFER)}function c(f){const u=[],p=f.index,g=f.attributes.position;let x=0;if(p!==null){const w=p.array;x=p.version;for(let b=0,M=w.length;b<M;b+=3){const I=w[b+0],P=w[b+1],A=w[b+2];u.push(I,P,P,A,A,I)}}else if(g!==void 0){const w=g.array;x=g.version;for(let b=0,M=w.length/3-1;b<M;b+=3){const I=b+0,P=b+1,A=b+2;u.push(I,P,P,A,A,I)}}else return;const m=new(sc(u)?uc:hc)(u,1);m.version=x;const h=r.get(f);h&&e.remove(h),r.set(f,m)}function d(f){const u=r.get(f);if(u){const p=f.index;p!==null&&u.version<p.version&&c(f)}else c(f);return r.get(f)}return{get:a,update:l,getWireframeAttribute:d}}function cp(i,e,t){let n;function s(u){n=u}let r,o;function a(u){r=u.type,o=u.bytesPerElement}function l(u,p){i.drawElements(n,p,r,u*o),t.update(p,n,1)}function c(u,p,g){g!==0&&(i.drawElementsInstanced(n,p,r,u*o,g),t.update(p,n,g))}function d(u,p,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,p,0,r,u,0,g);let m=0;for(let h=0;h<g;h++)m+=p[h];t.update(m,n,1)}function f(u,p,g,x){if(g===0)return;const m=e.get("WEBGL_multi_draw");if(m===null)for(let h=0;h<u.length;h++)c(u[h]/o,p[h],x[h]);else{m.multiDrawElementsInstancedWEBGL(n,p,0,r,u,0,x,0,g);let h=0;for(let w=0;w<g;w++)h+=p[w]*x[w];t.update(h,n,1)}}this.setMode=s,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=d,this.renderMultiDrawInstances=f}function hp(i){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function up(i,e,t){const n=new WeakMap,s=new Qe;function r(o,a,l){const c=o.morphTargetInfluences,d=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,f=d!==void 0?d.length:0;let u=n.get(a);if(u===void 0||u.count!==f){let y=function(){U.dispose(),n.delete(a),a.removeEventListener("dispose",y)};var p=y;u!==void 0&&u.texture.dispose();const g=a.morphAttributes.position!==void 0,x=a.morphAttributes.normal!==void 0,m=a.morphAttributes.color!==void 0,h=a.morphAttributes.position||[],w=a.morphAttributes.normal||[],b=a.morphAttributes.color||[];let M=0;g===!0&&(M=1),x===!0&&(M=2),m===!0&&(M=3);let I=a.attributes.position.count*M,P=1;I>e.maxTextureSize&&(P=Math.ceil(I/e.maxTextureSize),I=e.maxTextureSize);const A=new Float32Array(I*P*4*f),U=new oc(A,I,P,f);U.type=vn,U.needsUpdate=!0;const S=M*4;for(let C=0;C<f;C++){const G=h[C],k=w[C],$=b[C],j=I*P*4*C;for(let X=0;X<G.count;X++){const Z=X*S;g===!0&&(s.fromBufferAttribute(G,X),A[j+Z+0]=s.x,A[j+Z+1]=s.y,A[j+Z+2]=s.z,A[j+Z+3]=0),x===!0&&(s.fromBufferAttribute(k,X),A[j+Z+4]=s.x,A[j+Z+5]=s.y,A[j+Z+6]=s.z,A[j+Z+7]=0),m===!0&&(s.fromBufferAttribute($,X),A[j+Z+8]=s.x,A[j+Z+9]=s.y,A[j+Z+10]=s.z,A[j+Z+11]=$.itemSize===4?s.w:1)}}u={count:f,texture:U,size:new $e(I,P)},n.set(a,u),a.addEventListener("dispose",y)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",o.morphTexture,t);else{let g=0;for(let m=0;m<c.length;m++)g+=c[m];const x=a.morphTargetsRelative?1:1-g;l.getUniforms().setValue(i,"morphTargetBaseInfluence",x),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",u.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",u.size)}return{update:r}}function dp(i,e,t,n){let s=new WeakMap;function r(l){const c=n.render.frame,d=l.geometry,f=e.get(l,d);if(s.get(f)!==c&&(e.update(f),s.set(f,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){const u=l.skeleton;s.get(u)!==c&&(u.update(),s.set(u,c))}return f}function o(){s=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:o}}const vc=new Dt,nl=new mc(1,1),yc=new oc,xc=new Hh,Sc=new pc,il=[],sl=[],rl=new Float32Array(16),ol=new Float32Array(9),al=new Float32Array(4);function qi(i,e,t){const n=i[0];if(n<=0||n>0)return i;const s=e*t;let r=il[s];if(r===void 0&&(r=new Float32Array(s),il[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function mt(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function gt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function ar(i,e){let t=sl[e];t===void 0&&(t=new Int32Array(e),sl[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function fp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function pp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(mt(t,e))return;i.uniform2fv(this.addr,e),gt(t,e)}}function mp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(mt(t,e))return;i.uniform3fv(this.addr,e),gt(t,e)}}function gp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(mt(t,e))return;i.uniform4fv(this.addr,e),gt(t,e)}}function _p(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(mt(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),gt(t,e)}else{if(mt(t,n))return;al.set(n),i.uniformMatrix2fv(this.addr,!1,al),gt(t,n)}}function vp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(mt(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),gt(t,e)}else{if(mt(t,n))return;ol.set(n),i.uniformMatrix3fv(this.addr,!1,ol),gt(t,n)}}function yp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(mt(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),gt(t,e)}else{if(mt(t,n))return;rl.set(n),i.uniformMatrix4fv(this.addr,!1,rl),gt(t,n)}}function xp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Sp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(mt(t,e))return;i.uniform2iv(this.addr,e),gt(t,e)}}function Ep(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(mt(t,e))return;i.uniform3iv(this.addr,e),gt(t,e)}}function Mp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(mt(t,e))return;i.uniform4iv(this.addr,e),gt(t,e)}}function bp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function wp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(mt(t,e))return;i.uniform2uiv(this.addr,e),gt(t,e)}}function Tp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(mt(t,e))return;i.uniform3uiv(this.addr,e),gt(t,e)}}function Ap(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(mt(t,e))return;i.uniform4uiv(this.addr,e),gt(t,e)}}function Cp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(nl.compareFunction=ic,r=nl):r=vc,t.setTexture2D(e||r,s)}function Rp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||xc,s)}function Pp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||Sc,s)}function Lp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||yc,s)}function Dp(i){switch(i){case 5126:return fp;case 35664:return pp;case 35665:return mp;case 35666:return gp;case 35674:return _p;case 35675:return vp;case 35676:return yp;case 5124:case 35670:return xp;case 35667:case 35671:return Sp;case 35668:case 35672:return Ep;case 35669:case 35673:return Mp;case 5125:return bp;case 36294:return wp;case 36295:return Tp;case 36296:return Ap;case 35678:case 36198:case 36298:case 36306:case 35682:return Cp;case 35679:case 36299:case 36307:return Rp;case 35680:case 36300:case 36308:case 36293:return Pp;case 36289:case 36303:case 36311:case 36292:return Lp}}function Ip(i,e){i.uniform1fv(this.addr,e)}function Up(i,e){const t=qi(e,this.size,2);i.uniform2fv(this.addr,t)}function Np(i,e){const t=qi(e,this.size,3);i.uniform3fv(this.addr,t)}function Fp(i,e){const t=qi(e,this.size,4);i.uniform4fv(this.addr,t)}function Op(i,e){const t=qi(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function Bp(i,e){const t=qi(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function kp(i,e){const t=qi(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function zp(i,e){i.uniform1iv(this.addr,e)}function Hp(i,e){i.uniform2iv(this.addr,e)}function Vp(i,e){i.uniform3iv(this.addr,e)}function Gp(i,e){i.uniform4iv(this.addr,e)}function Wp(i,e){i.uniform1uiv(this.addr,e)}function Xp(i,e){i.uniform2uiv(this.addr,e)}function qp(i,e){i.uniform3uiv(this.addr,e)}function Yp(i,e){i.uniform4uiv(this.addr,e)}function $p(i,e,t){const n=this.cache,s=e.length,r=ar(t,s);mt(n,r)||(i.uniform1iv(this.addr,r),gt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||vc,r[o])}function jp(i,e,t){const n=this.cache,s=e.length,r=ar(t,s);mt(n,r)||(i.uniform1iv(this.addr,r),gt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||xc,r[o])}function Kp(i,e,t){const n=this.cache,s=e.length,r=ar(t,s);mt(n,r)||(i.uniform1iv(this.addr,r),gt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||Sc,r[o])}function Zp(i,e,t){const n=this.cache,s=e.length,r=ar(t,s);mt(n,r)||(i.uniform1iv(this.addr,r),gt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||yc,r[o])}function Jp(i){switch(i){case 5126:return Ip;case 35664:return Up;case 35665:return Np;case 35666:return Fp;case 35674:return Op;case 35675:return Bp;case 35676:return kp;case 5124:case 35670:return zp;case 35667:case 35671:return Hp;case 35668:case 35672:return Vp;case 35669:case 35673:return Gp;case 5125:return Wp;case 36294:return Xp;case 36295:return qp;case 36296:return Yp;case 35678:case 36198:case 36298:case 36306:case 35682:return $p;case 35679:case 36299:case 36307:return jp;case 35680:case 36300:case 36308:case 36293:return Kp;case 36289:case 36303:case 36311:case 36292:return Zp}}class Qp{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Dp(t.type)}}class em{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Jp(t.type)}}class tm{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const s=this.seq;for(let r=0,o=s.length;r!==o;++r){const a=s[r];a.setValue(e,t[a.id],n)}}}const Vr=/(\w+)(\])?(\[|\.)?/g;function ll(i,e){i.seq.push(e),i.map[e.id]=e}function nm(i,e,t){const n=i.name,s=n.length;for(Vr.lastIndex=0;;){const r=Vr.exec(n),o=Vr.lastIndex;let a=r[1];const l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){ll(t,c===void 0?new Qp(a,i,e):new em(a,i,e));break}else{let f=t.map[a];f===void 0&&(f=new tm(a),ll(t,f)),t=f}}}class $s{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);nm(r,o,this)}}setValue(e,t,n,s){const r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){const s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){const a=t[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,s)}}static seqWithValue(e,t){const n=[];for(let s=0,r=e.length;s!==r;++s){const o=e[s];o.id in t&&n.push(o)}return n}}function cl(i,e,t){const n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}const im=37297;let sm=0;function rm(i,e){const t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){const a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}const hl=new Re;function om(i){Xe._getMatrix(hl,Xe.workingColorSpace,i);const e=`mat3( ${hl.elements.map(t=>t.toFixed(4))} )`;switch(Xe.getTransfer(i)){case tr:return[e,"LinearTransferOETF"];case Ze:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function ul(i,e,t){const n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";const r=/ERROR: 0:(\d+)/.exec(s);if(r){const o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+rm(i.getShaderSource(e),o)}else return s}function am(i,e){const t=om(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function lm(i,e){let t;switch(e){case dh:t="Linear";break;case fh:t="Reinhard";break;case ph:t="Cineon";break;case mh:t="ACESFilmic";break;case _h:t="AgX";break;case vh:t="Neutral";break;case gh:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const zs=new N;function cm(){Xe.getLuminanceCoefficients(zs);const i=zs.x.toFixed(4),e=zs.y.toFixed(4),t=zs.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function hm(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(rs).join(`
`)}function um(i){const e=[];for(const t in i){const n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function dm(i,e){const t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(e,s),o=r.name;let a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function rs(i){return i!==""}function dl(i,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function fl(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const fm=/^[ \t]*#include +<([\w\d./]+)>/gm;function ko(i){return i.replace(fm,mm)}const pm=new Map;function mm(i,e){let t=De[e];if(t===void 0){const n=pm.get(e);if(n!==void 0)t=De[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return ko(t)}const gm=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function pl(i){return i.replace(gm,_m)}function _m(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function ml(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function vm(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===Wl?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===Xc?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===gn&&(e="SHADOWMAP_TYPE_VSM"),e}function ym(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case ki:case zi:e="ENVMAP_TYPE_CUBE";break;case sr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function xm(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case zi:e="ENVMAP_MODE_REFRACTION";break}return e}function Sm(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case Xl:e="ENVMAP_BLENDING_MULTIPLY";break;case hh:e="ENVMAP_BLENDING_MIX";break;case uh:e="ENVMAP_BLENDING_ADD";break}return e}function Em(i){const e=i.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function Mm(i,e,t,n){const s=i.getContext(),r=t.defines;let o=t.vertexShader,a=t.fragmentShader;const l=vm(t),c=ym(t),d=xm(t),f=Sm(t),u=Em(t),p=hm(t),g=um(r),x=s.createProgram();let m,h,w=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(rs).join(`
`),m.length>0&&(m+=`
`),h=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(rs).join(`
`),h.length>0&&(h+=`
`)):(m=[ml(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+d:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(rs).join(`
`),h=[ml(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+d:"",t.envMap?"#define "+f:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Fn?"#define TONE_MAPPING":"",t.toneMapping!==Fn?De.tonemapping_pars_fragment:"",t.toneMapping!==Fn?lm("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",De.colorspace_pars_fragment,am("linearToOutputTexel",t.outputColorSpace),cm(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(rs).join(`
`)),o=ko(o),o=dl(o,t),o=fl(o,t),a=ko(a),a=dl(a,t),a=fl(a,t),o=pl(o),a=pl(a),t.isRawShaderMaterial!==!0&&(w=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,h=["#define varying in",t.glslVersion===Ta?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Ta?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+h);const b=w+m+o,M=w+h+a,I=cl(s,s.VERTEX_SHADER,b),P=cl(s,s.FRAGMENT_SHADER,M);s.attachShader(x,I),s.attachShader(x,P),t.index0AttributeName!==void 0?s.bindAttribLocation(x,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(x,0,"position"),s.linkProgram(x);function A(C){if(i.debug.checkShaderErrors){const G=s.getProgramInfoLog(x).trim(),k=s.getShaderInfoLog(I).trim(),$=s.getShaderInfoLog(P).trim();let j=!0,X=!0;if(s.getProgramParameter(x,s.LINK_STATUS)===!1)if(j=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,x,I,P);else{const Z=ul(s,I,"vertex"),H=ul(s,P,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(x,s.VALIDATE_STATUS)+`

Material Name: `+C.name+`
Material Type: `+C.type+`

Program Info Log: `+G+`
`+Z+`
`+H)}else G!==""?console.warn("THREE.WebGLProgram: Program Info Log:",G):(k===""||$==="")&&(X=!1);X&&(C.diagnostics={runnable:j,programLog:G,vertexShader:{log:k,prefix:m},fragmentShader:{log:$,prefix:h}})}s.deleteShader(I),s.deleteShader(P),U=new $s(s,x),S=dm(s,x)}let U;this.getUniforms=function(){return U===void 0&&A(this),U};let S;this.getAttributes=function(){return S===void 0&&A(this),S};let y=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return y===!1&&(y=s.getProgramParameter(x,im)),y},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(x),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=sm++,this.cacheKey=e,this.usedTimes=1,this.program=x,this.vertexShader=I,this.fragmentShader=P,this}let bm=0;class wm{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new Tm(e),t.set(e,n)),n}}class Tm{constructor(e){this.id=bm++,this.code=e,this.usedTimes=0}}function Am(i,e,t,n,s,r,o){const a=new ac,l=new wm,c=new Set,d=[],f=s.logarithmicDepthBuffer,u=s.vertexTextures;let p=s.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(S){return c.add(S),S===0?"uv":`uv${S}`}function m(S,y,C,G,k){const $=G.fog,j=k.geometry,X=S.isMeshStandardMaterial?G.environment:null,Z=(S.isMeshStandardMaterial?t:e).get(S.envMap||X),H=Z&&Z.mapping===sr?Z.image.height:null,se=g[S.type];S.precision!==null&&(p=s.getMaxPrecision(S.precision),p!==S.precision&&console.warn("THREE.WebGLProgram.getParameters:",S.precision,"not supported, using",p,"instead."));const he=j.morphAttributes.position||j.morphAttributes.normal||j.morphAttributes.color,ve=he!==void 0?he.length:0;let Ie=0;j.morphAttributes.position!==void 0&&(Ie=1),j.morphAttributes.normal!==void 0&&(Ie=2),j.morphAttributes.color!==void 0&&(Ie=3);let et,W,ee,me;if(se){const je=sn[se];et=je.vertexShader,W=je.fragmentShader}else et=S.vertexShader,W=S.fragmentShader,l.update(S),ee=l.getVertexShaderID(S),me=l.getFragmentShaderID(S);const re=i.getRenderTarget(),Me=i.state.buffers.depth.getReversed(),Te=k.isInstancedMesh===!0,Ue=k.isBatchedMesh===!0,ot=!!S.map,ze=!!S.matcap,ut=!!Z,T=!!S.aoMap,zt=!!S.lightMap,Oe=!!S.bumpMap,Be=!!S.normalMap,ye=!!S.displacementMap,it=!!S.emissiveMap,_e=!!S.metalnessMap,E=!!S.roughnessMap,_=S.anisotropy>0,F=S.clearcoat>0,q=S.dispersion>0,K=S.iridescence>0,V=S.sheen>0,ge=S.transmission>0,oe=_&&!!S.anisotropyMap,ue=F&&!!S.clearcoatMap,He=F&&!!S.clearcoatNormalMap,Q=F&&!!S.clearcoatRoughnessMap,de=K&&!!S.iridescenceMap,Ee=K&&!!S.iridescenceThicknessMap,be=V&&!!S.sheenColorMap,fe=V&&!!S.sheenRoughnessMap,ke=!!S.specularMap,Pe=!!S.specularColorMap,nt=!!S.specularIntensityMap,R=ge&&!!S.transmissionMap,ne=ge&&!!S.thicknessMap,z=!!S.gradientMap,Y=!!S.alphaMap,le=S.alphaTest>0,ae=!!S.alphaHash,Ce=!!S.extensions;let lt=Fn;S.toneMapped&&(re===null||re.isXRRenderTarget===!0)&&(lt=i.toneMapping);const xt={shaderID:se,shaderType:S.type,shaderName:S.name,vertexShader:et,fragmentShader:W,defines:S.defines,customVertexShaderID:ee,customFragmentShaderID:me,isRawShaderMaterial:S.isRawShaderMaterial===!0,glslVersion:S.glslVersion,precision:p,batching:Ue,batchingColor:Ue&&k._colorsTexture!==null,instancing:Te,instancingColor:Te&&k.instanceColor!==null,instancingMorph:Te&&k.morphTexture!==null,supportsVertexTextures:u,outputColorSpace:re===null?i.outputColorSpace:re.isXRRenderTarget===!0?re.texture.colorSpace:Gi,alphaToCoverage:!!S.alphaToCoverage,map:ot,matcap:ze,envMap:ut,envMapMode:ut&&Z.mapping,envMapCubeUVHeight:H,aoMap:T,lightMap:zt,bumpMap:Oe,normalMap:Be,displacementMap:u&&ye,emissiveMap:it,normalMapObjectSpace:Be&&S.normalMapType===Mh,normalMapTangentSpace:Be&&S.normalMapType===Eh,metalnessMap:_e,roughnessMap:E,anisotropy:_,anisotropyMap:oe,clearcoat:F,clearcoatMap:ue,clearcoatNormalMap:He,clearcoatRoughnessMap:Q,dispersion:q,iridescence:K,iridescenceMap:de,iridescenceThicknessMap:Ee,sheen:V,sheenColorMap:be,sheenRoughnessMap:fe,specularMap:ke,specularColorMap:Pe,specularIntensityMap:nt,transmission:ge,transmissionMap:R,thicknessMap:ne,gradientMap:z,opaque:S.transparent===!1&&S.blending===Ui&&S.alphaToCoverage===!1,alphaMap:Y,alphaTest:le,alphaHash:ae,combine:S.combine,mapUv:ot&&x(S.map.channel),aoMapUv:T&&x(S.aoMap.channel),lightMapUv:zt&&x(S.lightMap.channel),bumpMapUv:Oe&&x(S.bumpMap.channel),normalMapUv:Be&&x(S.normalMap.channel),displacementMapUv:ye&&x(S.displacementMap.channel),emissiveMapUv:it&&x(S.emissiveMap.channel),metalnessMapUv:_e&&x(S.metalnessMap.channel),roughnessMapUv:E&&x(S.roughnessMap.channel),anisotropyMapUv:oe&&x(S.anisotropyMap.channel),clearcoatMapUv:ue&&x(S.clearcoatMap.channel),clearcoatNormalMapUv:He&&x(S.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Q&&x(S.clearcoatRoughnessMap.channel),iridescenceMapUv:de&&x(S.iridescenceMap.channel),iridescenceThicknessMapUv:Ee&&x(S.iridescenceThicknessMap.channel),sheenColorMapUv:be&&x(S.sheenColorMap.channel),sheenRoughnessMapUv:fe&&x(S.sheenRoughnessMap.channel),specularMapUv:ke&&x(S.specularMap.channel),specularColorMapUv:Pe&&x(S.specularColorMap.channel),specularIntensityMapUv:nt&&x(S.specularIntensityMap.channel),transmissionMapUv:R&&x(S.transmissionMap.channel),thicknessMapUv:ne&&x(S.thicknessMap.channel),alphaMapUv:Y&&x(S.alphaMap.channel),vertexTangents:!!j.attributes.tangent&&(Be||_),vertexColors:S.vertexColors,vertexAlphas:S.vertexColors===!0&&!!j.attributes.color&&j.attributes.color.itemSize===4,pointsUvs:k.isPoints===!0&&!!j.attributes.uv&&(ot||Y),fog:!!$,useFog:S.fog===!0,fogExp2:!!$&&$.isFogExp2,flatShading:S.flatShading===!0,sizeAttenuation:S.sizeAttenuation===!0,logarithmicDepthBuffer:f,reverseDepthBuffer:Me,skinning:k.isSkinnedMesh===!0,morphTargets:j.morphAttributes.position!==void 0,morphNormals:j.morphAttributes.normal!==void 0,morphColors:j.morphAttributes.color!==void 0,morphTargetsCount:ve,morphTextureStride:Ie,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:S.dithering,shadowMapEnabled:i.shadowMap.enabled&&C.length>0,shadowMapType:i.shadowMap.type,toneMapping:lt,decodeVideoTexture:ot&&S.map.isVideoTexture===!0&&Xe.getTransfer(S.map.colorSpace)===Ze,decodeVideoTextureEmissive:it&&S.emissiveMap.isVideoTexture===!0&&Xe.getTransfer(S.emissiveMap.colorSpace)===Ze,premultipliedAlpha:S.premultipliedAlpha,doubleSided:S.side===_n,flipSided:S.side===Lt,useDepthPacking:S.depthPacking>=0,depthPacking:S.depthPacking||0,index0AttributeName:S.index0AttributeName,extensionClipCullDistance:Ce&&S.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ce&&S.extensions.multiDraw===!0||Ue)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:S.customProgramCacheKey()};return xt.vertexUv1s=c.has(1),xt.vertexUv2s=c.has(2),xt.vertexUv3s=c.has(3),c.clear(),xt}function h(S){const y=[];if(S.shaderID?y.push(S.shaderID):(y.push(S.customVertexShaderID),y.push(S.customFragmentShaderID)),S.defines!==void 0)for(const C in S.defines)y.push(C),y.push(S.defines[C]);return S.isRawShaderMaterial===!1&&(w(y,S),b(y,S),y.push(i.outputColorSpace)),y.push(S.customProgramCacheKey),y.join()}function w(S,y){S.push(y.precision),S.push(y.outputColorSpace),S.push(y.envMapMode),S.push(y.envMapCubeUVHeight),S.push(y.mapUv),S.push(y.alphaMapUv),S.push(y.lightMapUv),S.push(y.aoMapUv),S.push(y.bumpMapUv),S.push(y.normalMapUv),S.push(y.displacementMapUv),S.push(y.emissiveMapUv),S.push(y.metalnessMapUv),S.push(y.roughnessMapUv),S.push(y.anisotropyMapUv),S.push(y.clearcoatMapUv),S.push(y.clearcoatNormalMapUv),S.push(y.clearcoatRoughnessMapUv),S.push(y.iridescenceMapUv),S.push(y.iridescenceThicknessMapUv),S.push(y.sheenColorMapUv),S.push(y.sheenRoughnessMapUv),S.push(y.specularMapUv),S.push(y.specularColorMapUv),S.push(y.specularIntensityMapUv),S.push(y.transmissionMapUv),S.push(y.thicknessMapUv),S.push(y.combine),S.push(y.fogExp2),S.push(y.sizeAttenuation),S.push(y.morphTargetsCount),S.push(y.morphAttributeCount),S.push(y.numDirLights),S.push(y.numPointLights),S.push(y.numSpotLights),S.push(y.numSpotLightMaps),S.push(y.numHemiLights),S.push(y.numRectAreaLights),S.push(y.numDirLightShadows),S.push(y.numPointLightShadows),S.push(y.numSpotLightShadows),S.push(y.numSpotLightShadowsWithMaps),S.push(y.numLightProbes),S.push(y.shadowMapType),S.push(y.toneMapping),S.push(y.numClippingPlanes),S.push(y.numClipIntersection),S.push(y.depthPacking)}function b(S,y){a.disableAll(),y.supportsVertexTextures&&a.enable(0),y.instancing&&a.enable(1),y.instancingColor&&a.enable(2),y.instancingMorph&&a.enable(3),y.matcap&&a.enable(4),y.envMap&&a.enable(5),y.normalMapObjectSpace&&a.enable(6),y.normalMapTangentSpace&&a.enable(7),y.clearcoat&&a.enable(8),y.iridescence&&a.enable(9),y.alphaTest&&a.enable(10),y.vertexColors&&a.enable(11),y.vertexAlphas&&a.enable(12),y.vertexUv1s&&a.enable(13),y.vertexUv2s&&a.enable(14),y.vertexUv3s&&a.enable(15),y.vertexTangents&&a.enable(16),y.anisotropy&&a.enable(17),y.alphaHash&&a.enable(18),y.batching&&a.enable(19),y.dispersion&&a.enable(20),y.batchingColor&&a.enable(21),S.push(a.mask),a.disableAll(),y.fog&&a.enable(0),y.useFog&&a.enable(1),y.flatShading&&a.enable(2),y.logarithmicDepthBuffer&&a.enable(3),y.reverseDepthBuffer&&a.enable(4),y.skinning&&a.enable(5),y.morphTargets&&a.enable(6),y.morphNormals&&a.enable(7),y.morphColors&&a.enable(8),y.premultipliedAlpha&&a.enable(9),y.shadowMapEnabled&&a.enable(10),y.doubleSided&&a.enable(11),y.flipSided&&a.enable(12),y.useDepthPacking&&a.enable(13),y.dithering&&a.enable(14),y.transmission&&a.enable(15),y.sheen&&a.enable(16),y.opaque&&a.enable(17),y.pointsUvs&&a.enable(18),y.decodeVideoTexture&&a.enable(19),y.decodeVideoTextureEmissive&&a.enable(20),y.alphaToCoverage&&a.enable(21),S.push(a.mask)}function M(S){const y=g[S.type];let C;if(y){const G=sn[y];C=eu.clone(G.uniforms)}else C=S.uniforms;return C}function I(S,y){let C;for(let G=0,k=d.length;G<k;G++){const $=d[G];if($.cacheKey===y){C=$,++C.usedTimes;break}}return C===void 0&&(C=new Mm(i,y,S,r),d.push(C)),C}function P(S){if(--S.usedTimes===0){const y=d.indexOf(S);d[y]=d[d.length-1],d.pop(),S.destroy()}}function A(S){l.remove(S)}function U(){l.dispose()}return{getParameters:m,getProgramCacheKey:h,getUniforms:M,acquireProgram:I,releaseProgram:P,releaseShaderCache:A,programs:d,dispose:U}}function Cm(){let i=new WeakMap;function e(o){return i.has(o)}function t(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function s(o,a,l){i.get(o)[a]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function Rm(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function gl(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function _l(){const i=[];let e=0;const t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(f,u,p,g,x,m){let h=i[e];return h===void 0?(h={id:f.id,object:f,geometry:u,material:p,groupOrder:g,renderOrder:f.renderOrder,z:x,group:m},i[e]=h):(h.id=f.id,h.object=f,h.geometry=u,h.material=p,h.groupOrder=g,h.renderOrder=f.renderOrder,h.z=x,h.group=m),e++,h}function a(f,u,p,g,x,m){const h=o(f,u,p,g,x,m);p.transmission>0?n.push(h):p.transparent===!0?s.push(h):t.push(h)}function l(f,u,p,g,x,m){const h=o(f,u,p,g,x,m);p.transmission>0?n.unshift(h):p.transparent===!0?s.unshift(h):t.unshift(h)}function c(f,u){t.length>1&&t.sort(f||Rm),n.length>1&&n.sort(u||gl),s.length>1&&s.sort(u||gl)}function d(){for(let f=e,u=i.length;f<u;f++){const p=i[f];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:d,sort:c}}function Pm(){let i=new WeakMap;function e(n,s){const r=i.get(n);let o;return r===void 0?(o=new _l,i.set(n,[o])):s>=r.length?(o=new _l,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function Lm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new N,color:new Ke};break;case"SpotLight":t={position:new N,direction:new N,color:new Ke,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new N,color:new Ke,distance:0,decay:0};break;case"HemisphereLight":t={direction:new N,skyColor:new Ke,groundColor:new Ke};break;case"RectAreaLight":t={color:new Ke,position:new N,halfWidth:new N,halfHeight:new N};break}return i[e.id]=t,t}}}function Dm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new $e};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new $e};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new $e,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}let Im=0;function Um(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function Nm(i){const e=new Lm,t=Dm(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new N);const s=new N,r=new at,o=new at;function a(c){let d=0,f=0,u=0;for(let S=0;S<9;S++)n.probe[S].set(0,0,0);let p=0,g=0,x=0,m=0,h=0,w=0,b=0,M=0,I=0,P=0,A=0;c.sort(Um);for(let S=0,y=c.length;S<y;S++){const C=c[S],G=C.color,k=C.intensity,$=C.distance,j=C.shadow&&C.shadow.map?C.shadow.map.texture:null;if(C.isAmbientLight)d+=G.r*k,f+=G.g*k,u+=G.b*k;else if(C.isLightProbe){for(let X=0;X<9;X++)n.probe[X].addScaledVector(C.sh.coefficients[X],k);A++}else if(C.isDirectionalLight){const X=e.get(C);if(X.color.copy(C.color).multiplyScalar(C.intensity),C.castShadow){const Z=C.shadow,H=t.get(C);H.shadowIntensity=Z.intensity,H.shadowBias=Z.bias,H.shadowNormalBias=Z.normalBias,H.shadowRadius=Z.radius,H.shadowMapSize=Z.mapSize,n.directionalShadow[p]=H,n.directionalShadowMap[p]=j,n.directionalShadowMatrix[p]=C.shadow.matrix,w++}n.directional[p]=X,p++}else if(C.isSpotLight){const X=e.get(C);X.position.setFromMatrixPosition(C.matrixWorld),X.color.copy(G).multiplyScalar(k),X.distance=$,X.coneCos=Math.cos(C.angle),X.penumbraCos=Math.cos(C.angle*(1-C.penumbra)),X.decay=C.decay,n.spot[x]=X;const Z=C.shadow;if(C.map&&(n.spotLightMap[I]=C.map,I++,Z.updateMatrices(C),C.castShadow&&P++),n.spotLightMatrix[x]=Z.matrix,C.castShadow){const H=t.get(C);H.shadowIntensity=Z.intensity,H.shadowBias=Z.bias,H.shadowNormalBias=Z.normalBias,H.shadowRadius=Z.radius,H.shadowMapSize=Z.mapSize,n.spotShadow[x]=H,n.spotShadowMap[x]=j,M++}x++}else if(C.isRectAreaLight){const X=e.get(C);X.color.copy(G).multiplyScalar(k),X.halfWidth.set(C.width*.5,0,0),X.halfHeight.set(0,C.height*.5,0),n.rectArea[m]=X,m++}else if(C.isPointLight){const X=e.get(C);if(X.color.copy(C.color).multiplyScalar(C.intensity),X.distance=C.distance,X.decay=C.decay,C.castShadow){const Z=C.shadow,H=t.get(C);H.shadowIntensity=Z.intensity,H.shadowBias=Z.bias,H.shadowNormalBias=Z.normalBias,H.shadowRadius=Z.radius,H.shadowMapSize=Z.mapSize,H.shadowCameraNear=Z.camera.near,H.shadowCameraFar=Z.camera.far,n.pointShadow[g]=H,n.pointShadowMap[g]=j,n.pointShadowMatrix[g]=C.shadow.matrix,b++}n.point[g]=X,g++}else if(C.isHemisphereLight){const X=e.get(C);X.skyColor.copy(C.color).multiplyScalar(k),X.groundColor.copy(C.groundColor).multiplyScalar(k),n.hemi[h]=X,h++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=te.LTC_FLOAT_1,n.rectAreaLTC2=te.LTC_FLOAT_2):(n.rectAreaLTC1=te.LTC_HALF_1,n.rectAreaLTC2=te.LTC_HALF_2)),n.ambient[0]=d,n.ambient[1]=f,n.ambient[2]=u;const U=n.hash;(U.directionalLength!==p||U.pointLength!==g||U.spotLength!==x||U.rectAreaLength!==m||U.hemiLength!==h||U.numDirectionalShadows!==w||U.numPointShadows!==b||U.numSpotShadows!==M||U.numSpotMaps!==I||U.numLightProbes!==A)&&(n.directional.length=p,n.spot.length=x,n.rectArea.length=m,n.point.length=g,n.hemi.length=h,n.directionalShadow.length=w,n.directionalShadowMap.length=w,n.pointShadow.length=b,n.pointShadowMap.length=b,n.spotShadow.length=M,n.spotShadowMap.length=M,n.directionalShadowMatrix.length=w,n.pointShadowMatrix.length=b,n.spotLightMatrix.length=M+I-P,n.spotLightMap.length=I,n.numSpotLightShadowsWithMaps=P,n.numLightProbes=A,U.directionalLength=p,U.pointLength=g,U.spotLength=x,U.rectAreaLength=m,U.hemiLength=h,U.numDirectionalShadows=w,U.numPointShadows=b,U.numSpotShadows=M,U.numSpotMaps=I,U.numLightProbes=A,n.version=Im++)}function l(c,d){let f=0,u=0,p=0,g=0,x=0;const m=d.matrixWorldInverse;for(let h=0,w=c.length;h<w;h++){const b=c[h];if(b.isDirectionalLight){const M=n.directional[f];M.direction.setFromMatrixPosition(b.matrixWorld),s.setFromMatrixPosition(b.target.matrixWorld),M.direction.sub(s),M.direction.transformDirection(m),f++}else if(b.isSpotLight){const M=n.spot[p];M.position.setFromMatrixPosition(b.matrixWorld),M.position.applyMatrix4(m),M.direction.setFromMatrixPosition(b.matrixWorld),s.setFromMatrixPosition(b.target.matrixWorld),M.direction.sub(s),M.direction.transformDirection(m),p++}else if(b.isRectAreaLight){const M=n.rectArea[g];M.position.setFromMatrixPosition(b.matrixWorld),M.position.applyMatrix4(m),o.identity(),r.copy(b.matrixWorld),r.premultiply(m),o.extractRotation(r),M.halfWidth.set(b.width*.5,0,0),M.halfHeight.set(0,b.height*.5,0),M.halfWidth.applyMatrix4(o),M.halfHeight.applyMatrix4(o),g++}else if(b.isPointLight){const M=n.point[u];M.position.setFromMatrixPosition(b.matrixWorld),M.position.applyMatrix4(m),u++}else if(b.isHemisphereLight){const M=n.hemi[x];M.direction.setFromMatrixPosition(b.matrixWorld),M.direction.transformDirection(m),x++}}}return{setup:a,setupView:l,state:n}}function vl(i){const e=new Nm(i),t=[],n=[];function s(d){c.camera=d,t.length=0,n.length=0}function r(d){t.push(d)}function o(d){n.push(d)}function a(){e.setup(t)}function l(d){e.setupView(t,d)}const c={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:a,setupLightsView:l,pushLight:r,pushShadow:o}}function Fm(i){let e=new WeakMap;function t(s,r=0){const o=e.get(s);let a;return o===void 0?(a=new vl(i),e.set(s,[a])):r>=o.length?(a=new vl(i),o.push(a)):a=o[r],a}function n(){e=new WeakMap}return{get:t,dispose:n}}const Om=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Bm=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function km(i,e,t){let n=new sa;const s=new $e,r=new $e,o=new Qe,a=new lu({depthPacking:Sh}),l=new cu,c={},d=t.maxTextureSize,f={[Bn]:Lt,[Lt]:Bn,[_n]:_n},u=new kn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new $e},radius:{value:4}},vertexShader:Om,fragmentShader:Bm}),p=u.clone();p.defines.HORIZONTAL_PASS=1;const g=new hi;g.setAttribute("position",new on(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const x=new xn(g,u),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Wl;let h=this.type;this.render=function(P,A,U){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||P.length===0)return;const S=i.getRenderTarget(),y=i.getActiveCubeFace(),C=i.getActiveMipmapLevel(),G=i.state;G.setBlending(Nn),G.buffers.color.setClear(1,1,1,1),G.buffers.depth.setTest(!0),G.setScissorTest(!1);const k=h!==gn&&this.type===gn,$=h===gn&&this.type!==gn;for(let j=0,X=P.length;j<X;j++){const Z=P[j],H=Z.shadow;if(H===void 0){console.warn("THREE.WebGLShadowMap:",Z,"has no shadow.");continue}if(H.autoUpdate===!1&&H.needsUpdate===!1)continue;s.copy(H.mapSize);const se=H.getFrameExtents();if(s.multiply(se),r.copy(H.mapSize),(s.x>d||s.y>d)&&(s.x>d&&(r.x=Math.floor(d/se.x),s.x=r.x*se.x,H.mapSize.x=r.x),s.y>d&&(r.y=Math.floor(d/se.y),s.y=r.y*se.y,H.mapSize.y=r.y)),H.map===null||k===!0||$===!0){const ve=this.type!==gn?{minFilter:nn,magFilter:nn}:{};H.map!==null&&H.map.dispose(),H.map=new ci(s.x,s.y,ve),H.map.texture.name=Z.name+".shadowMap",H.camera.updateProjectionMatrix()}i.setRenderTarget(H.map),i.clear();const he=H.getViewportCount();for(let ve=0;ve<he;ve++){const Ie=H.getViewport(ve);o.set(r.x*Ie.x,r.y*Ie.y,r.x*Ie.z,r.y*Ie.w),G.viewport(o),H.updateMatrices(Z,ve),n=H.getFrustum(),M(A,U,H.camera,Z,this.type)}H.isPointLightShadow!==!0&&this.type===gn&&w(H,U),H.needsUpdate=!1}h=this.type,m.needsUpdate=!1,i.setRenderTarget(S,y,C)};function w(P,A){const U=e.update(x);u.defines.VSM_SAMPLES!==P.blurSamples&&(u.defines.VSM_SAMPLES=P.blurSamples,p.defines.VSM_SAMPLES=P.blurSamples,u.needsUpdate=!0,p.needsUpdate=!0),P.mapPass===null&&(P.mapPass=new ci(s.x,s.y)),u.uniforms.shadow_pass.value=P.map.texture,u.uniforms.resolution.value=P.mapSize,u.uniforms.radius.value=P.radius,i.setRenderTarget(P.mapPass),i.clear(),i.renderBufferDirect(A,null,U,u,x,null),p.uniforms.shadow_pass.value=P.mapPass.texture,p.uniforms.resolution.value=P.mapSize,p.uniforms.radius.value=P.radius,i.setRenderTarget(P.map),i.clear(),i.renderBufferDirect(A,null,U,p,x,null)}function b(P,A,U,S){let y=null;const C=U.isPointLight===!0?P.customDistanceMaterial:P.customDepthMaterial;if(C!==void 0)y=C;else if(y=U.isPointLight===!0?l:a,i.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0){const G=y.uuid,k=A.uuid;let $=c[G];$===void 0&&($={},c[G]=$);let j=$[k];j===void 0&&(j=y.clone(),$[k]=j,A.addEventListener("dispose",I)),y=j}if(y.visible=A.visible,y.wireframe=A.wireframe,S===gn?y.side=A.shadowSide!==null?A.shadowSide:A.side:y.side=A.shadowSide!==null?A.shadowSide:f[A.side],y.alphaMap=A.alphaMap,y.alphaTest=A.alphaTest,y.map=A.map,y.clipShadows=A.clipShadows,y.clippingPlanes=A.clippingPlanes,y.clipIntersection=A.clipIntersection,y.displacementMap=A.displacementMap,y.displacementScale=A.displacementScale,y.displacementBias=A.displacementBias,y.wireframeLinewidth=A.wireframeLinewidth,y.linewidth=A.linewidth,U.isPointLight===!0&&y.isMeshDistanceMaterial===!0){const G=i.properties.get(y);G.light=U}return y}function M(P,A,U,S,y){if(P.visible===!1)return;if(P.layers.test(A.layers)&&(P.isMesh||P.isLine||P.isPoints)&&(P.castShadow||P.receiveShadow&&y===gn)&&(!P.frustumCulled||n.intersectsObject(P))){P.modelViewMatrix.multiplyMatrices(U.matrixWorldInverse,P.matrixWorld);const k=e.update(P),$=P.material;if(Array.isArray($)){const j=k.groups;for(let X=0,Z=j.length;X<Z;X++){const H=j[X],se=$[H.materialIndex];if(se&&se.visible){const he=b(P,se,S,y);P.onBeforeShadow(i,P,A,U,k,he,H),i.renderBufferDirect(U,null,k,he,P,H),P.onAfterShadow(i,P,A,U,k,he,H)}}}else if($.visible){const j=b(P,$,S,y);P.onBeforeShadow(i,P,A,U,k,j,null),i.renderBufferDirect(U,null,k,j,P,null),P.onAfterShadow(i,P,A,U,k,j,null)}}const G=P.children;for(let k=0,$=G.length;k<$;k++)M(G[k],A,U,S,y)}function I(P){P.target.removeEventListener("dispose",I);for(const U in c){const S=c[U],y=P.target.uuid;y in S&&(S[y].dispose(),delete S[y])}}}const zm={[eo]:to,[no]:ro,[io]:oo,[Bi]:so,[to]:eo,[ro]:no,[oo]:io,[so]:Bi};function Hm(i,e){function t(){let R=!1;const ne=new Qe;let z=null;const Y=new Qe(0,0,0,0);return{setMask:function(le){z!==le&&!R&&(i.colorMask(le,le,le,le),z=le)},setLocked:function(le){R=le},setClear:function(le,ae,Ce,lt,xt){xt===!0&&(le*=lt,ae*=lt,Ce*=lt),ne.set(le,ae,Ce,lt),Y.equals(ne)===!1&&(i.clearColor(le,ae,Ce,lt),Y.copy(ne))},reset:function(){R=!1,z=null,Y.set(-1,0,0,0)}}}function n(){let R=!1,ne=!1,z=null,Y=null,le=null;return{setReversed:function(ae){if(ne!==ae){const Ce=e.get("EXT_clip_control");ne?Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.ZERO_TO_ONE_EXT):Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.NEGATIVE_ONE_TO_ONE_EXT);const lt=le;le=null,this.setClear(lt)}ne=ae},getReversed:function(){return ne},setTest:function(ae){ae?re(i.DEPTH_TEST):Me(i.DEPTH_TEST)},setMask:function(ae){z!==ae&&!R&&(i.depthMask(ae),z=ae)},setFunc:function(ae){if(ne&&(ae=zm[ae]),Y!==ae){switch(ae){case eo:i.depthFunc(i.NEVER);break;case to:i.depthFunc(i.ALWAYS);break;case no:i.depthFunc(i.LESS);break;case Bi:i.depthFunc(i.LEQUAL);break;case io:i.depthFunc(i.EQUAL);break;case so:i.depthFunc(i.GEQUAL);break;case ro:i.depthFunc(i.GREATER);break;case oo:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}Y=ae}},setLocked:function(ae){R=ae},setClear:function(ae){le!==ae&&(ne&&(ae=1-ae),i.clearDepth(ae),le=ae)},reset:function(){R=!1,z=null,Y=null,le=null,ne=!1}}}function s(){let R=!1,ne=null,z=null,Y=null,le=null,ae=null,Ce=null,lt=null,xt=null;return{setTest:function(je){R||(je?re(i.STENCIL_TEST):Me(i.STENCIL_TEST))},setMask:function(je){ne!==je&&!R&&(i.stencilMask(je),ne=je)},setFunc:function(je,$t,cn){(z!==je||Y!==$t||le!==cn)&&(i.stencilFunc(je,$t,cn),z=je,Y=$t,le=cn)},setOp:function(je,$t,cn){(ae!==je||Ce!==$t||lt!==cn)&&(i.stencilOp(je,$t,cn),ae=je,Ce=$t,lt=cn)},setLocked:function(je){R=je},setClear:function(je){xt!==je&&(i.clearStencil(je),xt=je)},reset:function(){R=!1,ne=null,z=null,Y=null,le=null,ae=null,Ce=null,lt=null,xt=null}}}const r=new t,o=new n,a=new s,l=new WeakMap,c=new WeakMap;let d={},f={},u=new WeakMap,p=[],g=null,x=!1,m=null,h=null,w=null,b=null,M=null,I=null,P=null,A=new Ke(0,0,0),U=0,S=!1,y=null,C=null,G=null,k=null,$=null;const j=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let X=!1,Z=0;const H=i.getParameter(i.VERSION);H.indexOf("WebGL")!==-1?(Z=parseFloat(/^WebGL (\d)/.exec(H)[1]),X=Z>=1):H.indexOf("OpenGL ES")!==-1&&(Z=parseFloat(/^OpenGL ES (\d)/.exec(H)[1]),X=Z>=2);let se=null,he={};const ve=i.getParameter(i.SCISSOR_BOX),Ie=i.getParameter(i.VIEWPORT),et=new Qe().fromArray(ve),W=new Qe().fromArray(Ie);function ee(R,ne,z,Y){const le=new Uint8Array(4),ae=i.createTexture();i.bindTexture(R,ae),i.texParameteri(R,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(R,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ce=0;Ce<z;Ce++)R===i.TEXTURE_3D||R===i.TEXTURE_2D_ARRAY?i.texImage3D(ne,0,i.RGBA,1,1,Y,0,i.RGBA,i.UNSIGNED_BYTE,le):i.texImage2D(ne+Ce,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,le);return ae}const me={};me[i.TEXTURE_2D]=ee(i.TEXTURE_2D,i.TEXTURE_2D,1),me[i.TEXTURE_CUBE_MAP]=ee(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),me[i.TEXTURE_2D_ARRAY]=ee(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),me[i.TEXTURE_3D]=ee(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),o.setClear(1),a.setClear(0),re(i.DEPTH_TEST),o.setFunc(Bi),Oe(!1),Be(xa),re(i.CULL_FACE),T(Nn);function re(R){d[R]!==!0&&(i.enable(R),d[R]=!0)}function Me(R){d[R]!==!1&&(i.disable(R),d[R]=!1)}function Te(R,ne){return f[R]!==ne?(i.bindFramebuffer(R,ne),f[R]=ne,R===i.DRAW_FRAMEBUFFER&&(f[i.FRAMEBUFFER]=ne),R===i.FRAMEBUFFER&&(f[i.DRAW_FRAMEBUFFER]=ne),!0):!1}function Ue(R,ne){let z=p,Y=!1;if(R){z=u.get(ne),z===void 0&&(z=[],u.set(ne,z));const le=R.textures;if(z.length!==le.length||z[0]!==i.COLOR_ATTACHMENT0){for(let ae=0,Ce=le.length;ae<Ce;ae++)z[ae]=i.COLOR_ATTACHMENT0+ae;z.length=le.length,Y=!0}}else z[0]!==i.BACK&&(z[0]=i.BACK,Y=!0);Y&&i.drawBuffers(z)}function ot(R){return g!==R?(i.useProgram(R),g=R,!0):!1}const ze={[Qn]:i.FUNC_ADD,[Yc]:i.FUNC_SUBTRACT,[$c]:i.FUNC_REVERSE_SUBTRACT};ze[jc]=i.MIN,ze[Kc]=i.MAX;const ut={[Zc]:i.ZERO,[Jc]:i.ONE,[Qc]:i.SRC_COLOR,[Jr]:i.SRC_ALPHA,[rh]:i.SRC_ALPHA_SATURATE,[ih]:i.DST_COLOR,[th]:i.DST_ALPHA,[eh]:i.ONE_MINUS_SRC_COLOR,[Qr]:i.ONE_MINUS_SRC_ALPHA,[sh]:i.ONE_MINUS_DST_COLOR,[nh]:i.ONE_MINUS_DST_ALPHA,[oh]:i.CONSTANT_COLOR,[ah]:i.ONE_MINUS_CONSTANT_COLOR,[lh]:i.CONSTANT_ALPHA,[ch]:i.ONE_MINUS_CONSTANT_ALPHA};function T(R,ne,z,Y,le,ae,Ce,lt,xt,je){if(R===Nn){x===!0&&(Me(i.BLEND),x=!1);return}if(x===!1&&(re(i.BLEND),x=!0),R!==qc){if(R!==m||je!==S){if((h!==Qn||M!==Qn)&&(i.blendEquation(i.FUNC_ADD),h=Qn,M=Qn),je)switch(R){case Ui:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Sa:i.blendFunc(i.ONE,i.ONE);break;case Ea:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Ma:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",R);break}else switch(R){case Ui:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Sa:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case Ea:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Ma:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",R);break}w=null,b=null,I=null,P=null,A.set(0,0,0),U=0,m=R,S=je}return}le=le||ne,ae=ae||z,Ce=Ce||Y,(ne!==h||le!==M)&&(i.blendEquationSeparate(ze[ne],ze[le]),h=ne,M=le),(z!==w||Y!==b||ae!==I||Ce!==P)&&(i.blendFuncSeparate(ut[z],ut[Y],ut[ae],ut[Ce]),w=z,b=Y,I=ae,P=Ce),(lt.equals(A)===!1||xt!==U)&&(i.blendColor(lt.r,lt.g,lt.b,xt),A.copy(lt),U=xt),m=R,S=!1}function zt(R,ne){R.side===_n?Me(i.CULL_FACE):re(i.CULL_FACE);let z=R.side===Lt;ne&&(z=!z),Oe(z),R.blending===Ui&&R.transparent===!1?T(Nn):T(R.blending,R.blendEquation,R.blendSrc,R.blendDst,R.blendEquationAlpha,R.blendSrcAlpha,R.blendDstAlpha,R.blendColor,R.blendAlpha,R.premultipliedAlpha),o.setFunc(R.depthFunc),o.setTest(R.depthTest),o.setMask(R.depthWrite),r.setMask(R.colorWrite);const Y=R.stencilWrite;a.setTest(Y),Y&&(a.setMask(R.stencilWriteMask),a.setFunc(R.stencilFunc,R.stencilRef,R.stencilFuncMask),a.setOp(R.stencilFail,R.stencilZFail,R.stencilZPass)),it(R.polygonOffset,R.polygonOffsetFactor,R.polygonOffsetUnits),R.alphaToCoverage===!0?re(i.SAMPLE_ALPHA_TO_COVERAGE):Me(i.SAMPLE_ALPHA_TO_COVERAGE)}function Oe(R){y!==R&&(R?i.frontFace(i.CW):i.frontFace(i.CCW),y=R)}function Be(R){R!==Gc?(re(i.CULL_FACE),R!==C&&(R===xa?i.cullFace(i.BACK):R===Wc?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Me(i.CULL_FACE),C=R}function ye(R){R!==G&&(X&&i.lineWidth(R),G=R)}function it(R,ne,z){R?(re(i.POLYGON_OFFSET_FILL),(k!==ne||$!==z)&&(i.polygonOffset(ne,z),k=ne,$=z)):Me(i.POLYGON_OFFSET_FILL)}function _e(R){R?re(i.SCISSOR_TEST):Me(i.SCISSOR_TEST)}function E(R){R===void 0&&(R=i.TEXTURE0+j-1),se!==R&&(i.activeTexture(R),se=R)}function _(R,ne,z){z===void 0&&(se===null?z=i.TEXTURE0+j-1:z=se);let Y=he[z];Y===void 0&&(Y={type:void 0,texture:void 0},he[z]=Y),(Y.type!==R||Y.texture!==ne)&&(se!==z&&(i.activeTexture(z),se=z),i.bindTexture(R,ne||me[R]),Y.type=R,Y.texture=ne)}function F(){const R=he[se];R!==void 0&&R.type!==void 0&&(i.bindTexture(R.type,null),R.type=void 0,R.texture=void 0)}function q(){try{i.compressedTexImage2D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function K(){try{i.compressedTexImage3D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function V(){try{i.texSubImage2D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function ge(){try{i.texSubImage3D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function oe(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function ue(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function He(){try{i.texStorage2D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function Q(){try{i.texStorage3D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function de(){try{i.texImage2D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function Ee(){try{i.texImage3D.apply(i,arguments)}catch(R){console.error("THREE.WebGLState:",R)}}function be(R){et.equals(R)===!1&&(i.scissor(R.x,R.y,R.z,R.w),et.copy(R))}function fe(R){W.equals(R)===!1&&(i.viewport(R.x,R.y,R.z,R.w),W.copy(R))}function ke(R,ne){let z=c.get(ne);z===void 0&&(z=new WeakMap,c.set(ne,z));let Y=z.get(R);Y===void 0&&(Y=i.getUniformBlockIndex(ne,R.name),z.set(R,Y))}function Pe(R,ne){const Y=c.get(ne).get(R);l.get(ne)!==Y&&(i.uniformBlockBinding(ne,Y,R.__bindingPointIndex),l.set(ne,Y))}function nt(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),o.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),d={},se=null,he={},f={},u=new WeakMap,p=[],g=null,x=!1,m=null,h=null,w=null,b=null,M=null,I=null,P=null,A=new Ke(0,0,0),U=0,S=!1,y=null,C=null,G=null,k=null,$=null,et.set(0,0,i.canvas.width,i.canvas.height),W.set(0,0,i.canvas.width,i.canvas.height),r.reset(),o.reset(),a.reset()}return{buffers:{color:r,depth:o,stencil:a},enable:re,disable:Me,bindFramebuffer:Te,drawBuffers:Ue,useProgram:ot,setBlending:T,setMaterial:zt,setFlipSided:Oe,setCullFace:Be,setLineWidth:ye,setPolygonOffset:it,setScissorTest:_e,activeTexture:E,bindTexture:_,unbindTexture:F,compressedTexImage2D:q,compressedTexImage3D:K,texImage2D:de,texImage3D:Ee,updateUBOMapping:ke,uniformBlockBinding:Pe,texStorage2D:He,texStorage3D:Q,texSubImage2D:V,texSubImage3D:ge,compressedTexSubImage2D:oe,compressedTexSubImage3D:ue,scissor:be,viewport:fe,reset:nt}}function Vm(i,e,t,n,s,r,o){const a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new $e,d=new WeakMap;let f;const u=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(E,_){return p?new OffscreenCanvas(E,_):ir("canvas")}function x(E,_,F){let q=1;const K=_e(E);if((K.width>F||K.height>F)&&(q=F/Math.max(K.width,K.height)),q<1)if(typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&E instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&E instanceof ImageBitmap||typeof VideoFrame<"u"&&E instanceof VideoFrame){const V=Math.floor(q*K.width),ge=Math.floor(q*K.height);f===void 0&&(f=g(V,ge));const oe=_?g(V,ge):f;return oe.width=V,oe.height=ge,oe.getContext("2d").drawImage(E,0,0,V,ge),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+K.width+"x"+K.height+") to ("+V+"x"+ge+")."),oe}else return"data"in E&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+K.width+"x"+K.height+")."),E;return E}function m(E){return E.generateMipmaps}function h(E){i.generateMipmap(E)}function w(E){return E.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:E.isWebGL3DRenderTarget?i.TEXTURE_3D:E.isWebGLArrayRenderTarget||E.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function b(E,_,F,q,K=!1){if(E!==null){if(i[E]!==void 0)return i[E];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+E+"'")}let V=_;if(_===i.RED&&(F===i.FLOAT&&(V=i.R32F),F===i.HALF_FLOAT&&(V=i.R16F),F===i.UNSIGNED_BYTE&&(V=i.R8)),_===i.RED_INTEGER&&(F===i.UNSIGNED_BYTE&&(V=i.R8UI),F===i.UNSIGNED_SHORT&&(V=i.R16UI),F===i.UNSIGNED_INT&&(V=i.R32UI),F===i.BYTE&&(V=i.R8I),F===i.SHORT&&(V=i.R16I),F===i.INT&&(V=i.R32I)),_===i.RG&&(F===i.FLOAT&&(V=i.RG32F),F===i.HALF_FLOAT&&(V=i.RG16F),F===i.UNSIGNED_BYTE&&(V=i.RG8)),_===i.RG_INTEGER&&(F===i.UNSIGNED_BYTE&&(V=i.RG8UI),F===i.UNSIGNED_SHORT&&(V=i.RG16UI),F===i.UNSIGNED_INT&&(V=i.RG32UI),F===i.BYTE&&(V=i.RG8I),F===i.SHORT&&(V=i.RG16I),F===i.INT&&(V=i.RG32I)),_===i.RGB_INTEGER&&(F===i.UNSIGNED_BYTE&&(V=i.RGB8UI),F===i.UNSIGNED_SHORT&&(V=i.RGB16UI),F===i.UNSIGNED_INT&&(V=i.RGB32UI),F===i.BYTE&&(V=i.RGB8I),F===i.SHORT&&(V=i.RGB16I),F===i.INT&&(V=i.RGB32I)),_===i.RGBA_INTEGER&&(F===i.UNSIGNED_BYTE&&(V=i.RGBA8UI),F===i.UNSIGNED_SHORT&&(V=i.RGBA16UI),F===i.UNSIGNED_INT&&(V=i.RGBA32UI),F===i.BYTE&&(V=i.RGBA8I),F===i.SHORT&&(V=i.RGBA16I),F===i.INT&&(V=i.RGBA32I)),_===i.RGB&&F===i.UNSIGNED_INT_5_9_9_9_REV&&(V=i.RGB9_E5),_===i.RGBA){const ge=K?tr:Xe.getTransfer(q);F===i.FLOAT&&(V=i.RGBA32F),F===i.HALF_FLOAT&&(V=i.RGBA16F),F===i.UNSIGNED_BYTE&&(V=ge===Ze?i.SRGB8_ALPHA8:i.RGBA8),F===i.UNSIGNED_SHORT_4_4_4_4&&(V=i.RGBA4),F===i.UNSIGNED_SHORT_5_5_5_1&&(V=i.RGB5_A1)}return(V===i.R16F||V===i.R32F||V===i.RG16F||V===i.RG32F||V===i.RGBA16F||V===i.RGBA32F)&&e.get("EXT_color_buffer_float"),V}function M(E,_){let F;return E?_===null||_===li||_===Hi?F=i.DEPTH24_STENCIL8:_===vn?F=i.DEPTH32F_STENCIL8:_===hs&&(F=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):_===null||_===li||_===Hi?F=i.DEPTH_COMPONENT24:_===vn?F=i.DEPTH_COMPONENT32F:_===hs&&(F=i.DEPTH_COMPONENT16),F}function I(E,_){return m(E)===!0||E.isFramebufferTexture&&E.minFilter!==nn&&E.minFilter!==rn?Math.log2(Math.max(_.width,_.height))+1:E.mipmaps!==void 0&&E.mipmaps.length>0?E.mipmaps.length:E.isCompressedTexture&&Array.isArray(E.image)?_.mipmaps.length:1}function P(E){const _=E.target;_.removeEventListener("dispose",P),U(_),_.isVideoTexture&&d.delete(_)}function A(E){const _=E.target;_.removeEventListener("dispose",A),y(_)}function U(E){const _=n.get(E);if(_.__webglInit===void 0)return;const F=E.source,q=u.get(F);if(q){const K=q[_.__cacheKey];K.usedTimes--,K.usedTimes===0&&S(E),Object.keys(q).length===0&&u.delete(F)}n.remove(E)}function S(E){const _=n.get(E);i.deleteTexture(_.__webglTexture);const F=E.source,q=u.get(F);delete q[_.__cacheKey],o.memory.textures--}function y(E){const _=n.get(E);if(E.depthTexture&&(E.depthTexture.dispose(),n.remove(E.depthTexture)),E.isWebGLCubeRenderTarget)for(let q=0;q<6;q++){if(Array.isArray(_.__webglFramebuffer[q]))for(let K=0;K<_.__webglFramebuffer[q].length;K++)i.deleteFramebuffer(_.__webglFramebuffer[q][K]);else i.deleteFramebuffer(_.__webglFramebuffer[q]);_.__webglDepthbuffer&&i.deleteRenderbuffer(_.__webglDepthbuffer[q])}else{if(Array.isArray(_.__webglFramebuffer))for(let q=0;q<_.__webglFramebuffer.length;q++)i.deleteFramebuffer(_.__webglFramebuffer[q]);else i.deleteFramebuffer(_.__webglFramebuffer);if(_.__webglDepthbuffer&&i.deleteRenderbuffer(_.__webglDepthbuffer),_.__webglMultisampledFramebuffer&&i.deleteFramebuffer(_.__webglMultisampledFramebuffer),_.__webglColorRenderbuffer)for(let q=0;q<_.__webglColorRenderbuffer.length;q++)_.__webglColorRenderbuffer[q]&&i.deleteRenderbuffer(_.__webglColorRenderbuffer[q]);_.__webglDepthRenderbuffer&&i.deleteRenderbuffer(_.__webglDepthRenderbuffer)}const F=E.textures;for(let q=0,K=F.length;q<K;q++){const V=n.get(F[q]);V.__webglTexture&&(i.deleteTexture(V.__webglTexture),o.memory.textures--),n.remove(F[q])}n.remove(E)}let C=0;function G(){C=0}function k(){const E=C;return E>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+E+" texture units while this GPU supports only "+s.maxTextures),C+=1,E}function $(E){const _=[];return _.push(E.wrapS),_.push(E.wrapT),_.push(E.wrapR||0),_.push(E.magFilter),_.push(E.minFilter),_.push(E.anisotropy),_.push(E.internalFormat),_.push(E.format),_.push(E.type),_.push(E.generateMipmaps),_.push(E.premultiplyAlpha),_.push(E.flipY),_.push(E.unpackAlignment),_.push(E.colorSpace),_.join()}function j(E,_){const F=n.get(E);if(E.isVideoTexture&&ye(E),E.isRenderTargetTexture===!1&&E.version>0&&F.__version!==E.version){const q=E.image;if(q===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(q.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{W(F,E,_);return}}t.bindTexture(i.TEXTURE_2D,F.__webglTexture,i.TEXTURE0+_)}function X(E,_){const F=n.get(E);if(E.version>0&&F.__version!==E.version){W(F,E,_);return}t.bindTexture(i.TEXTURE_2D_ARRAY,F.__webglTexture,i.TEXTURE0+_)}function Z(E,_){const F=n.get(E);if(E.version>0&&F.__version!==E.version){W(F,E,_);return}t.bindTexture(i.TEXTURE_3D,F.__webglTexture,i.TEXTURE0+_)}function H(E,_){const F=n.get(E);if(E.version>0&&F.__version!==E.version){ee(F,E,_);return}t.bindTexture(i.TEXTURE_CUBE_MAP,F.__webglTexture,i.TEXTURE0+_)}const se={[co]:i.REPEAT,[ni]:i.CLAMP_TO_EDGE,[ho]:i.MIRRORED_REPEAT},he={[nn]:i.NEAREST,[yh]:i.NEAREST_MIPMAP_NEAREST,[ys]:i.NEAREST_MIPMAP_LINEAR,[rn]:i.LINEAR,[dr]:i.LINEAR_MIPMAP_NEAREST,[ii]:i.LINEAR_MIPMAP_LINEAR},ve={[bh]:i.NEVER,[Ph]:i.ALWAYS,[wh]:i.LESS,[ic]:i.LEQUAL,[Th]:i.EQUAL,[Rh]:i.GEQUAL,[Ah]:i.GREATER,[Ch]:i.NOTEQUAL};function Ie(E,_){if(_.type===vn&&e.has("OES_texture_float_linear")===!1&&(_.magFilter===rn||_.magFilter===dr||_.magFilter===ys||_.magFilter===ii||_.minFilter===rn||_.minFilter===dr||_.minFilter===ys||_.minFilter===ii)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(E,i.TEXTURE_WRAP_S,se[_.wrapS]),i.texParameteri(E,i.TEXTURE_WRAP_T,se[_.wrapT]),(E===i.TEXTURE_3D||E===i.TEXTURE_2D_ARRAY)&&i.texParameteri(E,i.TEXTURE_WRAP_R,se[_.wrapR]),i.texParameteri(E,i.TEXTURE_MAG_FILTER,he[_.magFilter]),i.texParameteri(E,i.TEXTURE_MIN_FILTER,he[_.minFilter]),_.compareFunction&&(i.texParameteri(E,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(E,i.TEXTURE_COMPARE_FUNC,ve[_.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(_.magFilter===nn||_.minFilter!==ys&&_.minFilter!==ii||_.type===vn&&e.has("OES_texture_float_linear")===!1)return;if(_.anisotropy>1||n.get(_).__currentAnisotropy){const F=e.get("EXT_texture_filter_anisotropic");i.texParameterf(E,F.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(_.anisotropy,s.getMaxAnisotropy())),n.get(_).__currentAnisotropy=_.anisotropy}}}function et(E,_){let F=!1;E.__webglInit===void 0&&(E.__webglInit=!0,_.addEventListener("dispose",P));const q=_.source;let K=u.get(q);K===void 0&&(K={},u.set(q,K));const V=$(_);if(V!==E.__cacheKey){K[V]===void 0&&(K[V]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,F=!0),K[V].usedTimes++;const ge=K[E.__cacheKey];ge!==void 0&&(K[E.__cacheKey].usedTimes--,ge.usedTimes===0&&S(_)),E.__cacheKey=V,E.__webglTexture=K[V].texture}return F}function W(E,_,F){let q=i.TEXTURE_2D;(_.isDataArrayTexture||_.isCompressedArrayTexture)&&(q=i.TEXTURE_2D_ARRAY),_.isData3DTexture&&(q=i.TEXTURE_3D);const K=et(E,_),V=_.source;t.bindTexture(q,E.__webglTexture,i.TEXTURE0+F);const ge=n.get(V);if(V.version!==ge.__version||K===!0){t.activeTexture(i.TEXTURE0+F);const oe=Xe.getPrimaries(Xe.workingColorSpace),ue=_.colorSpace===In?null:Xe.getPrimaries(_.colorSpace),He=_.colorSpace===In||oe===ue?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,_.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,_.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,_.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,He);let Q=x(_.image,!1,s.maxTextureSize);Q=it(_,Q);const de=r.convert(_.format,_.colorSpace),Ee=r.convert(_.type);let be=b(_.internalFormat,de,Ee,_.colorSpace,_.isVideoTexture);Ie(q,_);let fe;const ke=_.mipmaps,Pe=_.isVideoTexture!==!0,nt=ge.__version===void 0||K===!0,R=V.dataReady,ne=I(_,Q);if(_.isDepthTexture)be=M(_.format===Vi,_.type),nt&&(Pe?t.texStorage2D(i.TEXTURE_2D,1,be,Q.width,Q.height):t.texImage2D(i.TEXTURE_2D,0,be,Q.width,Q.height,0,de,Ee,null));else if(_.isDataTexture)if(ke.length>0){Pe&&nt&&t.texStorage2D(i.TEXTURE_2D,ne,be,ke[0].width,ke[0].height);for(let z=0,Y=ke.length;z<Y;z++)fe=ke[z],Pe?R&&t.texSubImage2D(i.TEXTURE_2D,z,0,0,fe.width,fe.height,de,Ee,fe.data):t.texImage2D(i.TEXTURE_2D,z,be,fe.width,fe.height,0,de,Ee,fe.data);_.generateMipmaps=!1}else Pe?(nt&&t.texStorage2D(i.TEXTURE_2D,ne,be,Q.width,Q.height),R&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,Q.width,Q.height,de,Ee,Q.data)):t.texImage2D(i.TEXTURE_2D,0,be,Q.width,Q.height,0,de,Ee,Q.data);else if(_.isCompressedTexture)if(_.isCompressedArrayTexture){Pe&&nt&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ne,be,ke[0].width,ke[0].height,Q.depth);for(let z=0,Y=ke.length;z<Y;z++)if(fe=ke[z],_.format!==tn)if(de!==null)if(Pe){if(R)if(_.layerUpdates.size>0){const le=$a(fe.width,fe.height,_.format,_.type);for(const ae of _.layerUpdates){const Ce=fe.data.subarray(ae*le/fe.data.BYTES_PER_ELEMENT,(ae+1)*le/fe.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,z,0,0,ae,fe.width,fe.height,1,de,Ce)}_.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,z,0,0,0,fe.width,fe.height,Q.depth,de,fe.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,z,be,fe.width,fe.height,Q.depth,0,fe.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Pe?R&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,z,0,0,0,fe.width,fe.height,Q.depth,de,Ee,fe.data):t.texImage3D(i.TEXTURE_2D_ARRAY,z,be,fe.width,fe.height,Q.depth,0,de,Ee,fe.data)}else{Pe&&nt&&t.texStorage2D(i.TEXTURE_2D,ne,be,ke[0].width,ke[0].height);for(let z=0,Y=ke.length;z<Y;z++)fe=ke[z],_.format!==tn?de!==null?Pe?R&&t.compressedTexSubImage2D(i.TEXTURE_2D,z,0,0,fe.width,fe.height,de,fe.data):t.compressedTexImage2D(i.TEXTURE_2D,z,be,fe.width,fe.height,0,fe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Pe?R&&t.texSubImage2D(i.TEXTURE_2D,z,0,0,fe.width,fe.height,de,Ee,fe.data):t.texImage2D(i.TEXTURE_2D,z,be,fe.width,fe.height,0,de,Ee,fe.data)}else if(_.isDataArrayTexture)if(Pe){if(nt&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ne,be,Q.width,Q.height,Q.depth),R)if(_.layerUpdates.size>0){const z=$a(Q.width,Q.height,_.format,_.type);for(const Y of _.layerUpdates){const le=Q.data.subarray(Y*z/Q.data.BYTES_PER_ELEMENT,(Y+1)*z/Q.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,Y,Q.width,Q.height,1,de,Ee,le)}_.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Q.width,Q.height,Q.depth,de,Ee,Q.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,be,Q.width,Q.height,Q.depth,0,de,Ee,Q.data);else if(_.isData3DTexture)Pe?(nt&&t.texStorage3D(i.TEXTURE_3D,ne,be,Q.width,Q.height,Q.depth),R&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Q.width,Q.height,Q.depth,de,Ee,Q.data)):t.texImage3D(i.TEXTURE_3D,0,be,Q.width,Q.height,Q.depth,0,de,Ee,Q.data);else if(_.isFramebufferTexture){if(nt)if(Pe)t.texStorage2D(i.TEXTURE_2D,ne,be,Q.width,Q.height);else{let z=Q.width,Y=Q.height;for(let le=0;le<ne;le++)t.texImage2D(i.TEXTURE_2D,le,be,z,Y,0,de,Ee,null),z>>=1,Y>>=1}}else if(ke.length>0){if(Pe&&nt){const z=_e(ke[0]);t.texStorage2D(i.TEXTURE_2D,ne,be,z.width,z.height)}for(let z=0,Y=ke.length;z<Y;z++)fe=ke[z],Pe?R&&t.texSubImage2D(i.TEXTURE_2D,z,0,0,de,Ee,fe):t.texImage2D(i.TEXTURE_2D,z,be,de,Ee,fe);_.generateMipmaps=!1}else if(Pe){if(nt){const z=_e(Q);t.texStorage2D(i.TEXTURE_2D,ne,be,z.width,z.height)}R&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,de,Ee,Q)}else t.texImage2D(i.TEXTURE_2D,0,be,de,Ee,Q);m(_)&&h(q),ge.__version=V.version,_.onUpdate&&_.onUpdate(_)}E.__version=_.version}function ee(E,_,F){if(_.image.length!==6)return;const q=et(E,_),K=_.source;t.bindTexture(i.TEXTURE_CUBE_MAP,E.__webglTexture,i.TEXTURE0+F);const V=n.get(K);if(K.version!==V.__version||q===!0){t.activeTexture(i.TEXTURE0+F);const ge=Xe.getPrimaries(Xe.workingColorSpace),oe=_.colorSpace===In?null:Xe.getPrimaries(_.colorSpace),ue=_.colorSpace===In||ge===oe?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,_.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,_.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,_.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,ue);const He=_.isCompressedTexture||_.image[0].isCompressedTexture,Q=_.image[0]&&_.image[0].isDataTexture,de=[];for(let Y=0;Y<6;Y++)!He&&!Q?de[Y]=x(_.image[Y],!0,s.maxCubemapSize):de[Y]=Q?_.image[Y].image:_.image[Y],de[Y]=it(_,de[Y]);const Ee=de[0],be=r.convert(_.format,_.colorSpace),fe=r.convert(_.type),ke=b(_.internalFormat,be,fe,_.colorSpace),Pe=_.isVideoTexture!==!0,nt=V.__version===void 0||q===!0,R=K.dataReady;let ne=I(_,Ee);Ie(i.TEXTURE_CUBE_MAP,_);let z;if(He){Pe&&nt&&t.texStorage2D(i.TEXTURE_CUBE_MAP,ne,ke,Ee.width,Ee.height);for(let Y=0;Y<6;Y++){z=de[Y].mipmaps;for(let le=0;le<z.length;le++){const ae=z[le];_.format!==tn?be!==null?Pe?R&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le,0,0,ae.width,ae.height,be,ae.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le,ke,ae.width,ae.height,0,ae.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Pe?R&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le,0,0,ae.width,ae.height,be,fe,ae.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le,ke,ae.width,ae.height,0,be,fe,ae.data)}}}else{if(z=_.mipmaps,Pe&&nt){z.length>0&&ne++;const Y=_e(de[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,ne,ke,Y.width,Y.height)}for(let Y=0;Y<6;Y++)if(Q){Pe?R&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0,0,0,de[Y].width,de[Y].height,be,fe,de[Y].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0,ke,de[Y].width,de[Y].height,0,be,fe,de[Y].data);for(let le=0;le<z.length;le++){const Ce=z[le].image[Y].image;Pe?R&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le+1,0,0,Ce.width,Ce.height,be,fe,Ce.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le+1,ke,Ce.width,Ce.height,0,be,fe,Ce.data)}}else{Pe?R&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0,0,0,be,fe,de[Y]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,0,ke,be,fe,de[Y]);for(let le=0;le<z.length;le++){const ae=z[le];Pe?R&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le+1,0,0,be,fe,ae.image[Y]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+Y,le+1,ke,be,fe,ae.image[Y])}}}m(_)&&h(i.TEXTURE_CUBE_MAP),V.__version=K.version,_.onUpdate&&_.onUpdate(_)}E.__version=_.version}function me(E,_,F,q,K,V){const ge=r.convert(F.format,F.colorSpace),oe=r.convert(F.type),ue=b(F.internalFormat,ge,oe,F.colorSpace),He=n.get(_),Q=n.get(F);if(Q.__renderTarget=_,!He.__hasExternalTextures){const de=Math.max(1,_.width>>V),Ee=Math.max(1,_.height>>V);K===i.TEXTURE_3D||K===i.TEXTURE_2D_ARRAY?t.texImage3D(K,V,ue,de,Ee,_.depth,0,ge,oe,null):t.texImage2D(K,V,ue,de,Ee,0,ge,oe,null)}t.bindFramebuffer(i.FRAMEBUFFER,E),Be(_)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,q,K,Q.__webglTexture,0,Oe(_)):(K===i.TEXTURE_2D||K>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&K<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,q,K,Q.__webglTexture,V),t.bindFramebuffer(i.FRAMEBUFFER,null)}function re(E,_,F){if(i.bindRenderbuffer(i.RENDERBUFFER,E),_.depthBuffer){const q=_.depthTexture,K=q&&q.isDepthTexture?q.type:null,V=M(_.stencilBuffer,K),ge=_.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,oe=Oe(_);Be(_)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,oe,V,_.width,_.height):F?i.renderbufferStorageMultisample(i.RENDERBUFFER,oe,V,_.width,_.height):i.renderbufferStorage(i.RENDERBUFFER,V,_.width,_.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,ge,i.RENDERBUFFER,E)}else{const q=_.textures;for(let K=0;K<q.length;K++){const V=q[K],ge=r.convert(V.format,V.colorSpace),oe=r.convert(V.type),ue=b(V.internalFormat,ge,oe,V.colorSpace),He=Oe(_);F&&Be(_)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,He,ue,_.width,_.height):Be(_)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,He,ue,_.width,_.height):i.renderbufferStorage(i.RENDERBUFFER,ue,_.width,_.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Me(E,_){if(_&&_.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,E),!(_.depthTexture&&_.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const q=n.get(_.depthTexture);q.__renderTarget=_,(!q.__webglTexture||_.depthTexture.image.width!==_.width||_.depthTexture.image.height!==_.height)&&(_.depthTexture.image.width=_.width,_.depthTexture.image.height=_.height,_.depthTexture.needsUpdate=!0),j(_.depthTexture,0);const K=q.__webglTexture,V=Oe(_);if(_.depthTexture.format===Ni)Be(_)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,K,0,V):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,K,0);else if(_.depthTexture.format===Vi)Be(_)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,K,0,V):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,K,0);else throw new Error("Unknown depthTexture format")}function Te(E){const _=n.get(E),F=E.isWebGLCubeRenderTarget===!0;if(_.__boundDepthTexture!==E.depthTexture){const q=E.depthTexture;if(_.__depthDisposeCallback&&_.__depthDisposeCallback(),q){const K=()=>{delete _.__boundDepthTexture,delete _.__depthDisposeCallback,q.removeEventListener("dispose",K)};q.addEventListener("dispose",K),_.__depthDisposeCallback=K}_.__boundDepthTexture=q}if(E.depthTexture&&!_.__autoAllocateDepthBuffer){if(F)throw new Error("target.depthTexture not supported in Cube render targets");Me(_.__webglFramebuffer,E)}else if(F){_.__webglDepthbuffer=[];for(let q=0;q<6;q++)if(t.bindFramebuffer(i.FRAMEBUFFER,_.__webglFramebuffer[q]),_.__webglDepthbuffer[q]===void 0)_.__webglDepthbuffer[q]=i.createRenderbuffer(),re(_.__webglDepthbuffer[q],E,!1);else{const K=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,V=_.__webglDepthbuffer[q];i.bindRenderbuffer(i.RENDERBUFFER,V),i.framebufferRenderbuffer(i.FRAMEBUFFER,K,i.RENDERBUFFER,V)}}else if(t.bindFramebuffer(i.FRAMEBUFFER,_.__webglFramebuffer),_.__webglDepthbuffer===void 0)_.__webglDepthbuffer=i.createRenderbuffer(),re(_.__webglDepthbuffer,E,!1);else{const q=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,K=_.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,K),i.framebufferRenderbuffer(i.FRAMEBUFFER,q,i.RENDERBUFFER,K)}t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ue(E,_,F){const q=n.get(E);_!==void 0&&me(q.__webglFramebuffer,E,E.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),F!==void 0&&Te(E)}function ot(E){const _=E.texture,F=n.get(E),q=n.get(_);E.addEventListener("dispose",A);const K=E.textures,V=E.isWebGLCubeRenderTarget===!0,ge=K.length>1;if(ge||(q.__webglTexture===void 0&&(q.__webglTexture=i.createTexture()),q.__version=_.version,o.memory.textures++),V){F.__webglFramebuffer=[];for(let oe=0;oe<6;oe++)if(_.mipmaps&&_.mipmaps.length>0){F.__webglFramebuffer[oe]=[];for(let ue=0;ue<_.mipmaps.length;ue++)F.__webglFramebuffer[oe][ue]=i.createFramebuffer()}else F.__webglFramebuffer[oe]=i.createFramebuffer()}else{if(_.mipmaps&&_.mipmaps.length>0){F.__webglFramebuffer=[];for(let oe=0;oe<_.mipmaps.length;oe++)F.__webglFramebuffer[oe]=i.createFramebuffer()}else F.__webglFramebuffer=i.createFramebuffer();if(ge)for(let oe=0,ue=K.length;oe<ue;oe++){const He=n.get(K[oe]);He.__webglTexture===void 0&&(He.__webglTexture=i.createTexture(),o.memory.textures++)}if(E.samples>0&&Be(E)===!1){F.__webglMultisampledFramebuffer=i.createFramebuffer(),F.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,F.__webglMultisampledFramebuffer);for(let oe=0;oe<K.length;oe++){const ue=K[oe];F.__webglColorRenderbuffer[oe]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,F.__webglColorRenderbuffer[oe]);const He=r.convert(ue.format,ue.colorSpace),Q=r.convert(ue.type),de=b(ue.internalFormat,He,Q,ue.colorSpace,E.isXRRenderTarget===!0),Ee=Oe(E);i.renderbufferStorageMultisample(i.RENDERBUFFER,Ee,de,E.width,E.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+oe,i.RENDERBUFFER,F.__webglColorRenderbuffer[oe])}i.bindRenderbuffer(i.RENDERBUFFER,null),E.depthBuffer&&(F.__webglDepthRenderbuffer=i.createRenderbuffer(),re(F.__webglDepthRenderbuffer,E,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(V){t.bindTexture(i.TEXTURE_CUBE_MAP,q.__webglTexture),Ie(i.TEXTURE_CUBE_MAP,_);for(let oe=0;oe<6;oe++)if(_.mipmaps&&_.mipmaps.length>0)for(let ue=0;ue<_.mipmaps.length;ue++)me(F.__webglFramebuffer[oe][ue],E,_,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,ue);else me(F.__webglFramebuffer[oe],E,_,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+oe,0);m(_)&&h(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(ge){for(let oe=0,ue=K.length;oe<ue;oe++){const He=K[oe],Q=n.get(He);t.bindTexture(i.TEXTURE_2D,Q.__webglTexture),Ie(i.TEXTURE_2D,He),me(F.__webglFramebuffer,E,He,i.COLOR_ATTACHMENT0+oe,i.TEXTURE_2D,0),m(He)&&h(i.TEXTURE_2D)}t.unbindTexture()}else{let oe=i.TEXTURE_2D;if((E.isWebGL3DRenderTarget||E.isWebGLArrayRenderTarget)&&(oe=E.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(oe,q.__webglTexture),Ie(oe,_),_.mipmaps&&_.mipmaps.length>0)for(let ue=0;ue<_.mipmaps.length;ue++)me(F.__webglFramebuffer[ue],E,_,i.COLOR_ATTACHMENT0,oe,ue);else me(F.__webglFramebuffer,E,_,i.COLOR_ATTACHMENT0,oe,0);m(_)&&h(oe),t.unbindTexture()}E.depthBuffer&&Te(E)}function ze(E){const _=E.textures;for(let F=0,q=_.length;F<q;F++){const K=_[F];if(m(K)){const V=w(E),ge=n.get(K).__webglTexture;t.bindTexture(V,ge),h(V),t.unbindTexture()}}}const ut=[],T=[];function zt(E){if(E.samples>0){if(Be(E)===!1){const _=E.textures,F=E.width,q=E.height;let K=i.COLOR_BUFFER_BIT;const V=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ge=n.get(E),oe=_.length>1;if(oe)for(let ue=0;ue<_.length;ue++)t.bindFramebuffer(i.FRAMEBUFFER,ge.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ue,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,ge.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ue,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,ge.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ge.__webglFramebuffer);for(let ue=0;ue<_.length;ue++){if(E.resolveDepthBuffer&&(E.depthBuffer&&(K|=i.DEPTH_BUFFER_BIT),E.stencilBuffer&&E.resolveStencilBuffer&&(K|=i.STENCIL_BUFFER_BIT)),oe){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,ge.__webglColorRenderbuffer[ue]);const He=n.get(_[ue]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,He,0)}i.blitFramebuffer(0,0,F,q,0,0,F,q,K,i.NEAREST),l===!0&&(ut.length=0,T.length=0,ut.push(i.COLOR_ATTACHMENT0+ue),E.depthBuffer&&E.resolveDepthBuffer===!1&&(ut.push(V),T.push(V),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,T)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,ut))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),oe)for(let ue=0;ue<_.length;ue++){t.bindFramebuffer(i.FRAMEBUFFER,ge.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ue,i.RENDERBUFFER,ge.__webglColorRenderbuffer[ue]);const He=n.get(_[ue]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,ge.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ue,i.TEXTURE_2D,He,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,ge.__webglMultisampledFramebuffer)}else if(E.depthBuffer&&E.resolveDepthBuffer===!1&&l){const _=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[_])}}}function Oe(E){return Math.min(s.maxSamples,E.samples)}function Be(E){const _=n.get(E);return E.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&_.__useRenderToTexture!==!1}function ye(E){const _=o.render.frame;d.get(E)!==_&&(d.set(E,_),E.update())}function it(E,_){const F=E.colorSpace,q=E.format,K=E.type;return E.isCompressedTexture===!0||E.isVideoTexture===!0||F!==Gi&&F!==In&&(Xe.getTransfer(F)===Ze?(q!==tn||K!==En)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",F)),_}function _e(E){return typeof HTMLImageElement<"u"&&E instanceof HTMLImageElement?(c.width=E.naturalWidth||E.width,c.height=E.naturalHeight||E.height):typeof VideoFrame<"u"&&E instanceof VideoFrame?(c.width=E.displayWidth,c.height=E.displayHeight):(c.width=E.width,c.height=E.height),c}this.allocateTextureUnit=k,this.resetTextureUnits=G,this.setTexture2D=j,this.setTexture2DArray=X,this.setTexture3D=Z,this.setTextureCube=H,this.rebindTextures=Ue,this.setupRenderTarget=ot,this.updateRenderTargetMipmap=ze,this.updateMultisampleRenderTarget=zt,this.setupDepthRenderbuffer=Te,this.setupFrameBufferTexture=me,this.useMultisampledRTT=Be}function Gm(i,e){function t(n,s=In){let r;const o=Xe.getTransfer(s);if(n===En)return i.UNSIGNED_BYTE;if(n===Jo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Qo)return i.UNSIGNED_SHORT_5_5_5_1;if(n===jl)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Yl)return i.BYTE;if(n===$l)return i.SHORT;if(n===hs)return i.UNSIGNED_SHORT;if(n===Zo)return i.INT;if(n===li)return i.UNSIGNED_INT;if(n===vn)return i.FLOAT;if(n===ds)return i.HALF_FLOAT;if(n===Kl)return i.ALPHA;if(n===Zl)return i.RGB;if(n===tn)return i.RGBA;if(n===Jl)return i.LUMINANCE;if(n===Ql)return i.LUMINANCE_ALPHA;if(n===Ni)return i.DEPTH_COMPONENT;if(n===Vi)return i.DEPTH_STENCIL;if(n===ec)return i.RED;if(n===ea)return i.RED_INTEGER;if(n===tc)return i.RG;if(n===ta)return i.RG_INTEGER;if(n===na)return i.RGBA_INTEGER;if(n===Gs||n===Ws||n===Xs||n===qs)if(o===Ze)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Gs)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Ws)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Xs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===qs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Gs)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Ws)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Xs)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===qs)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===uo||n===fo||n===po||n===mo)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===uo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===fo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===po)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===mo)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===go||n===_o||n===vo)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===go||n===_o)return o===Ze?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===vo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===yo||n===xo||n===So||n===Eo||n===Mo||n===bo||n===wo||n===To||n===Ao||n===Co||n===Ro||n===Po||n===Lo||n===Do)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===yo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===xo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===So)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Eo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===Mo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===bo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===wo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===To)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Ao)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Co)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Ro)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Po)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Lo)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Do)return o===Ze?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Ys||n===Io||n===Uo)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Ys)return o===Ze?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Io)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Uo)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===nc||n===No||n===Fo||n===Oo)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===Ys)return r.COMPRESSED_RED_RGTC1_EXT;if(n===No)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Fo)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Oo)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Hi?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}const Wm={type:"move"};class Gr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Os,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Os,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new N,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new N),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Os,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new N,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new N),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(const x of e.hand.values()){const m=t.getJointPose(x,n),h=this._getHandJoint(c,x);m!==null&&(h.matrix.fromArray(m.transform.matrix),h.matrix.decompose(h.position,h.rotation,h.scale),h.matrixWorldNeedsUpdate=!0,h.jointRadius=m.radius),h.visible=m!==null}const d=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],u=d.position.distanceTo(f.position),p=.02,g=.005;c.inputState.pinching&&u>p+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&u<=p-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(Wm)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new Os;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}const Xm=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,qm=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Ym{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){const s=new Dt,r=e.properties.get(s);r.__webglTexture=t.texture,(t.depthNear!==n.depthNear||t.depthFar!==n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=s}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new kn({vertexShader:Xm,fragmentShader:qm,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new xn(new or(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class $m extends Xi{constructor(e,t){super();const n=this;let s=null,r=1,o=null,a="local-floor",l=1,c=null,d=null,f=null,u=null,p=null,g=null;const x=new Ym,m=t.getContextAttributes();let h=null,w=null;const b=[],M=[],I=new $e;let P=null;const A=new Bt;A.viewport=new Qe;const U=new Bt;U.viewport=new Qe;const S=[A,U],y=new pu;let C=null,G=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(W){let ee=b[W];return ee===void 0&&(ee=new Gr,b[W]=ee),ee.getTargetRaySpace()},this.getControllerGrip=function(W){let ee=b[W];return ee===void 0&&(ee=new Gr,b[W]=ee),ee.getGripSpace()},this.getHand=function(W){let ee=b[W];return ee===void 0&&(ee=new Gr,b[W]=ee),ee.getHandSpace()};function k(W){const ee=M.indexOf(W.inputSource);if(ee===-1)return;const me=b[ee];me!==void 0&&(me.update(W.inputSource,W.frame,c||o),me.dispatchEvent({type:W.type,data:W.inputSource}))}function $(){s.removeEventListener("select",k),s.removeEventListener("selectstart",k),s.removeEventListener("selectend",k),s.removeEventListener("squeeze",k),s.removeEventListener("squeezestart",k),s.removeEventListener("squeezeend",k),s.removeEventListener("end",$),s.removeEventListener("inputsourceschange",j);for(let W=0;W<b.length;W++){const ee=M[W];ee!==null&&(M[W]=null,b[W].disconnect(ee))}C=null,G=null,x.reset(),e.setRenderTarget(h),p=null,u=null,f=null,s=null,w=null,et.stop(),n.isPresenting=!1,e.setPixelRatio(P),e.setSize(I.width,I.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(W){r=W,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(W){a=W,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(W){c=W},this.getBaseLayer=function(){return u!==null?u:p},this.getBinding=function(){return f},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(W){if(s=W,s!==null){if(h=e.getRenderTarget(),s.addEventListener("select",k),s.addEventListener("selectstart",k),s.addEventListener("selectend",k),s.addEventListener("squeeze",k),s.addEventListener("squeezestart",k),s.addEventListener("squeezeend",k),s.addEventListener("end",$),s.addEventListener("inputsourceschange",j),m.xrCompatible!==!0&&await t.makeXRCompatible(),P=e.getPixelRatio(),e.getSize(I),s.enabledFeatures!==void 0&&s.enabledFeatures.includes("layers")){let me=null,re=null,Me=null;m.depth&&(Me=m.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,me=m.stencil?Vi:Ni,re=m.stencil?Hi:li);const Te={colorFormat:t.RGBA8,depthFormat:Me,scaleFactor:r};f=new XRWebGLBinding(s,t),u=f.createProjectionLayer(Te),s.updateRenderState({layers:[u]}),e.setPixelRatio(1),e.setSize(u.textureWidth,u.textureHeight,!1),w=new ci(u.textureWidth,u.textureHeight,{format:tn,type:En,depthTexture:new mc(u.textureWidth,u.textureHeight,re,void 0,void 0,void 0,void 0,void 0,void 0,me),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1})}else{const me={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:r};p=new XRWebGLLayer(s,t,me),s.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),w=new ci(p.framebufferWidth,p.framebufferHeight,{format:tn,type:En,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil})}w.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),et.setContext(s),et.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return x.getDepthTexture()};function j(W){for(let ee=0;ee<W.removed.length;ee++){const me=W.removed[ee],re=M.indexOf(me);re>=0&&(M[re]=null,b[re].disconnect(me))}for(let ee=0;ee<W.added.length;ee++){const me=W.added[ee];let re=M.indexOf(me);if(re===-1){for(let Te=0;Te<b.length;Te++)if(Te>=M.length){M.push(me),re=Te;break}else if(M[Te]===null){M[Te]=me,re=Te;break}if(re===-1)break}const Me=b[re];Me&&Me.connect(me)}}const X=new N,Z=new N;function H(W,ee,me){X.setFromMatrixPosition(ee.matrixWorld),Z.setFromMatrixPosition(me.matrixWorld);const re=X.distanceTo(Z),Me=ee.projectionMatrix.elements,Te=me.projectionMatrix.elements,Ue=Me[14]/(Me[10]-1),ot=Me[14]/(Me[10]+1),ze=(Me[9]+1)/Me[5],ut=(Me[9]-1)/Me[5],T=(Me[8]-1)/Me[0],zt=(Te[8]+1)/Te[0],Oe=Ue*T,Be=Ue*zt,ye=re/(-T+zt),it=ye*-T;if(ee.matrixWorld.decompose(W.position,W.quaternion,W.scale),W.translateX(it),W.translateZ(ye),W.matrixWorld.compose(W.position,W.quaternion,W.scale),W.matrixWorldInverse.copy(W.matrixWorld).invert(),Me[10]===-1)W.projectionMatrix.copy(ee.projectionMatrix),W.projectionMatrixInverse.copy(ee.projectionMatrixInverse);else{const _e=Ue+ye,E=ot+ye,_=Oe-it,F=Be+(re-it),q=ze*ot/E*_e,K=ut*ot/E*_e;W.projectionMatrix.makePerspective(_,F,q,K,_e,E),W.projectionMatrixInverse.copy(W.projectionMatrix).invert()}}function se(W,ee){ee===null?W.matrixWorld.copy(W.matrix):W.matrixWorld.multiplyMatrices(ee.matrixWorld,W.matrix),W.matrixWorldInverse.copy(W.matrixWorld).invert()}this.updateCamera=function(W){if(s===null)return;let ee=W.near,me=W.far;x.texture!==null&&(x.depthNear>0&&(ee=x.depthNear),x.depthFar>0&&(me=x.depthFar)),y.near=U.near=A.near=ee,y.far=U.far=A.far=me,(C!==y.near||G!==y.far)&&(s.updateRenderState({depthNear:y.near,depthFar:y.far}),C=y.near,G=y.far),A.layers.mask=W.layers.mask|2,U.layers.mask=W.layers.mask|4,y.layers.mask=A.layers.mask|U.layers.mask;const re=W.parent,Me=y.cameras;se(y,re);for(let Te=0;Te<Me.length;Te++)se(Me[Te],re);Me.length===2?H(y,A,U):y.projectionMatrix.copy(A.projectionMatrix),he(W,y,re)};function he(W,ee,me){me===null?W.matrix.copy(ee.matrixWorld):(W.matrix.copy(me.matrixWorld),W.matrix.invert(),W.matrix.multiply(ee.matrixWorld)),W.matrix.decompose(W.position,W.quaternion,W.scale),W.updateMatrixWorld(!0),W.projectionMatrix.copy(ee.projectionMatrix),W.projectionMatrixInverse.copy(ee.projectionMatrixInverse),W.isPerspectiveCamera&&(W.fov=Bo*2*Math.atan(1/W.projectionMatrix.elements[5]),W.zoom=1)}this.getCamera=function(){return y},this.getFoveation=function(){if(!(u===null&&p===null))return l},this.setFoveation=function(W){l=W,u!==null&&(u.fixedFoveation=W),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=W)},this.hasDepthSensing=function(){return x.texture!==null},this.getDepthSensingMesh=function(){return x.getMesh(y)};let ve=null;function Ie(W,ee){if(d=ee.getViewerPose(c||o),g=ee,d!==null){const me=d.views;p!==null&&(e.setRenderTargetFramebuffer(w,p.framebuffer),e.setRenderTarget(w));let re=!1;me.length!==y.cameras.length&&(y.cameras.length=0,re=!0);for(let Te=0;Te<me.length;Te++){const Ue=me[Te];let ot=null;if(p!==null)ot=p.getViewport(Ue);else{const ut=f.getViewSubImage(u,Ue);ot=ut.viewport,Te===0&&(e.setRenderTargetTextures(w,ut.colorTexture,u.ignoreDepthValues?void 0:ut.depthStencilTexture),e.setRenderTarget(w))}let ze=S[Te];ze===void 0&&(ze=new Bt,ze.layers.enable(Te),ze.viewport=new Qe,S[Te]=ze),ze.matrix.fromArray(Ue.transform.matrix),ze.matrix.decompose(ze.position,ze.quaternion,ze.scale),ze.projectionMatrix.fromArray(Ue.projectionMatrix),ze.projectionMatrixInverse.copy(ze.projectionMatrix).invert(),ze.viewport.set(ot.x,ot.y,ot.width,ot.height),Te===0&&(y.matrix.copy(ze.matrix),y.matrix.decompose(y.position,y.quaternion,y.scale)),re===!0&&y.cameras.push(ze)}const Me=s.enabledFeatures;if(Me&&Me.includes("depth-sensing")){const Te=f.getDepthInformation(me[0]);Te&&Te.isValid&&Te.texture&&x.init(e,Te,s.renderState)}}for(let me=0;me<b.length;me++){const re=M[me],Me=b[me];re!==null&&Me!==void 0&&Me.update(re,ee,c||o)}ve&&ve(W,ee),ee.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ee}),g=null}const et=new _c;et.setAnimationLoop(Ie),this.setAnimationLoop=function(W){ve=W},this.dispose=function(){}}}const Yn=new Mn,jm=new at;function Km(i,e){function t(m,h){m.matrixAutoUpdate===!0&&m.updateMatrix(),h.value.copy(m.matrix)}function n(m,h){h.color.getRGB(m.fogColor.value,dc(i)),h.isFog?(m.fogNear.value=h.near,m.fogFar.value=h.far):h.isFogExp2&&(m.fogDensity.value=h.density)}function s(m,h,w,b,M){h.isMeshBasicMaterial||h.isMeshLambertMaterial?r(m,h):h.isMeshToonMaterial?(r(m,h),f(m,h)):h.isMeshPhongMaterial?(r(m,h),d(m,h)):h.isMeshStandardMaterial?(r(m,h),u(m,h),h.isMeshPhysicalMaterial&&p(m,h,M)):h.isMeshMatcapMaterial?(r(m,h),g(m,h)):h.isMeshDepthMaterial?r(m,h):h.isMeshDistanceMaterial?(r(m,h),x(m,h)):h.isMeshNormalMaterial?r(m,h):h.isLineBasicMaterial?(o(m,h),h.isLineDashedMaterial&&a(m,h)):h.isPointsMaterial?l(m,h,w,b):h.isSpriteMaterial?c(m,h):h.isShadowMaterial?(m.color.value.copy(h.color),m.opacity.value=h.opacity):h.isShaderMaterial&&(h.uniformsNeedUpdate=!1)}function r(m,h){m.opacity.value=h.opacity,h.color&&m.diffuse.value.copy(h.color),h.emissive&&m.emissive.value.copy(h.emissive).multiplyScalar(h.emissiveIntensity),h.map&&(m.map.value=h.map,t(h.map,m.mapTransform)),h.alphaMap&&(m.alphaMap.value=h.alphaMap,t(h.alphaMap,m.alphaMapTransform)),h.bumpMap&&(m.bumpMap.value=h.bumpMap,t(h.bumpMap,m.bumpMapTransform),m.bumpScale.value=h.bumpScale,h.side===Lt&&(m.bumpScale.value*=-1)),h.normalMap&&(m.normalMap.value=h.normalMap,t(h.normalMap,m.normalMapTransform),m.normalScale.value.copy(h.normalScale),h.side===Lt&&m.normalScale.value.negate()),h.displacementMap&&(m.displacementMap.value=h.displacementMap,t(h.displacementMap,m.displacementMapTransform),m.displacementScale.value=h.displacementScale,m.displacementBias.value=h.displacementBias),h.emissiveMap&&(m.emissiveMap.value=h.emissiveMap,t(h.emissiveMap,m.emissiveMapTransform)),h.specularMap&&(m.specularMap.value=h.specularMap,t(h.specularMap,m.specularMapTransform)),h.alphaTest>0&&(m.alphaTest.value=h.alphaTest);const w=e.get(h),b=w.envMap,M=w.envMapRotation;b&&(m.envMap.value=b,Yn.copy(M),Yn.x*=-1,Yn.y*=-1,Yn.z*=-1,b.isCubeTexture&&b.isRenderTargetTexture===!1&&(Yn.y*=-1,Yn.z*=-1),m.envMapRotation.value.setFromMatrix4(jm.makeRotationFromEuler(Yn)),m.flipEnvMap.value=b.isCubeTexture&&b.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=h.reflectivity,m.ior.value=h.ior,m.refractionRatio.value=h.refractionRatio),h.lightMap&&(m.lightMap.value=h.lightMap,m.lightMapIntensity.value=h.lightMapIntensity,t(h.lightMap,m.lightMapTransform)),h.aoMap&&(m.aoMap.value=h.aoMap,m.aoMapIntensity.value=h.aoMapIntensity,t(h.aoMap,m.aoMapTransform))}function o(m,h){m.diffuse.value.copy(h.color),m.opacity.value=h.opacity,h.map&&(m.map.value=h.map,t(h.map,m.mapTransform))}function a(m,h){m.dashSize.value=h.dashSize,m.totalSize.value=h.dashSize+h.gapSize,m.scale.value=h.scale}function l(m,h,w,b){m.diffuse.value.copy(h.color),m.opacity.value=h.opacity,m.size.value=h.size*w,m.scale.value=b*.5,h.map&&(m.map.value=h.map,t(h.map,m.uvTransform)),h.alphaMap&&(m.alphaMap.value=h.alphaMap,t(h.alphaMap,m.alphaMapTransform)),h.alphaTest>0&&(m.alphaTest.value=h.alphaTest)}function c(m,h){m.diffuse.value.copy(h.color),m.opacity.value=h.opacity,m.rotation.value=h.rotation,h.map&&(m.map.value=h.map,t(h.map,m.mapTransform)),h.alphaMap&&(m.alphaMap.value=h.alphaMap,t(h.alphaMap,m.alphaMapTransform)),h.alphaTest>0&&(m.alphaTest.value=h.alphaTest)}function d(m,h){m.specular.value.copy(h.specular),m.shininess.value=Math.max(h.shininess,1e-4)}function f(m,h){h.gradientMap&&(m.gradientMap.value=h.gradientMap)}function u(m,h){m.metalness.value=h.metalness,h.metalnessMap&&(m.metalnessMap.value=h.metalnessMap,t(h.metalnessMap,m.metalnessMapTransform)),m.roughness.value=h.roughness,h.roughnessMap&&(m.roughnessMap.value=h.roughnessMap,t(h.roughnessMap,m.roughnessMapTransform)),h.envMap&&(m.envMapIntensity.value=h.envMapIntensity)}function p(m,h,w){m.ior.value=h.ior,h.sheen>0&&(m.sheenColor.value.copy(h.sheenColor).multiplyScalar(h.sheen),m.sheenRoughness.value=h.sheenRoughness,h.sheenColorMap&&(m.sheenColorMap.value=h.sheenColorMap,t(h.sheenColorMap,m.sheenColorMapTransform)),h.sheenRoughnessMap&&(m.sheenRoughnessMap.value=h.sheenRoughnessMap,t(h.sheenRoughnessMap,m.sheenRoughnessMapTransform))),h.clearcoat>0&&(m.clearcoat.value=h.clearcoat,m.clearcoatRoughness.value=h.clearcoatRoughness,h.clearcoatMap&&(m.clearcoatMap.value=h.clearcoatMap,t(h.clearcoatMap,m.clearcoatMapTransform)),h.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=h.clearcoatRoughnessMap,t(h.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),h.clearcoatNormalMap&&(m.clearcoatNormalMap.value=h.clearcoatNormalMap,t(h.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(h.clearcoatNormalScale),h.side===Lt&&m.clearcoatNormalScale.value.negate())),h.dispersion>0&&(m.dispersion.value=h.dispersion),h.iridescence>0&&(m.iridescence.value=h.iridescence,m.iridescenceIOR.value=h.iridescenceIOR,m.iridescenceThicknessMinimum.value=h.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=h.iridescenceThicknessRange[1],h.iridescenceMap&&(m.iridescenceMap.value=h.iridescenceMap,t(h.iridescenceMap,m.iridescenceMapTransform)),h.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=h.iridescenceThicknessMap,t(h.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),h.transmission>0&&(m.transmission.value=h.transmission,m.transmissionSamplerMap.value=w.texture,m.transmissionSamplerSize.value.set(w.width,w.height),h.transmissionMap&&(m.transmissionMap.value=h.transmissionMap,t(h.transmissionMap,m.transmissionMapTransform)),m.thickness.value=h.thickness,h.thicknessMap&&(m.thicknessMap.value=h.thicknessMap,t(h.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=h.attenuationDistance,m.attenuationColor.value.copy(h.attenuationColor)),h.anisotropy>0&&(m.anisotropyVector.value.set(h.anisotropy*Math.cos(h.anisotropyRotation),h.anisotropy*Math.sin(h.anisotropyRotation)),h.anisotropyMap&&(m.anisotropyMap.value=h.anisotropyMap,t(h.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=h.specularIntensity,m.specularColor.value.copy(h.specularColor),h.specularColorMap&&(m.specularColorMap.value=h.specularColorMap,t(h.specularColorMap,m.specularColorMapTransform)),h.specularIntensityMap&&(m.specularIntensityMap.value=h.specularIntensityMap,t(h.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,h){h.matcap&&(m.matcap.value=h.matcap)}function x(m,h){const w=e.get(h).light;m.referencePosition.value.setFromMatrixPosition(w.matrixWorld),m.nearDistance.value=w.shadow.camera.near,m.farDistance.value=w.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Zm(i,e,t,n){let s={},r={},o=[];const a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(w,b){const M=b.program;n.uniformBlockBinding(w,M)}function c(w,b){let M=s[w.id];M===void 0&&(g(w),M=d(w),s[w.id]=M,w.addEventListener("dispose",m));const I=b.program;n.updateUBOMapping(w,I);const P=e.render.frame;r[w.id]!==P&&(u(w),r[w.id]=P)}function d(w){const b=f();w.__bindingPointIndex=b;const M=i.createBuffer(),I=w.__size,P=w.usage;return i.bindBuffer(i.UNIFORM_BUFFER,M),i.bufferData(i.UNIFORM_BUFFER,I,P),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,b,M),M}function f(){for(let w=0;w<a;w++)if(o.indexOf(w)===-1)return o.push(w),w;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(w){const b=s[w.id],M=w.uniforms,I=w.__cache;i.bindBuffer(i.UNIFORM_BUFFER,b);for(let P=0,A=M.length;P<A;P++){const U=Array.isArray(M[P])?M[P]:[M[P]];for(let S=0,y=U.length;S<y;S++){const C=U[S];if(p(C,P,S,I)===!0){const G=C.__offset,k=Array.isArray(C.value)?C.value:[C.value];let $=0;for(let j=0;j<k.length;j++){const X=k[j],Z=x(X);typeof X=="number"||typeof X=="boolean"?(C.__data[0]=X,i.bufferSubData(i.UNIFORM_BUFFER,G+$,C.__data)):X.isMatrix3?(C.__data[0]=X.elements[0],C.__data[1]=X.elements[1],C.__data[2]=X.elements[2],C.__data[3]=0,C.__data[4]=X.elements[3],C.__data[5]=X.elements[4],C.__data[6]=X.elements[5],C.__data[7]=0,C.__data[8]=X.elements[6],C.__data[9]=X.elements[7],C.__data[10]=X.elements[8],C.__data[11]=0):(X.toArray(C.__data,$),$+=Z.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,G,C.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function p(w,b,M,I){const P=w.value,A=b+"_"+M;if(I[A]===void 0)return typeof P=="number"||typeof P=="boolean"?I[A]=P:I[A]=P.clone(),!0;{const U=I[A];if(typeof P=="number"||typeof P=="boolean"){if(U!==P)return I[A]=P,!0}else if(U.equals(P)===!1)return U.copy(P),!0}return!1}function g(w){const b=w.uniforms;let M=0;const I=16;for(let A=0,U=b.length;A<U;A++){const S=Array.isArray(b[A])?b[A]:[b[A]];for(let y=0,C=S.length;y<C;y++){const G=S[y],k=Array.isArray(G.value)?G.value:[G.value];for(let $=0,j=k.length;$<j;$++){const X=k[$],Z=x(X),H=M%I,se=H%Z.boundary,he=H+se;M+=se,he!==0&&I-he<Z.storage&&(M+=I-he),G.__data=new Float32Array(Z.storage/Float32Array.BYTES_PER_ELEMENT),G.__offset=M,M+=Z.storage}}}const P=M%I;return P>0&&(M+=I-P),w.__size=M,w.__cache={},this}function x(w){const b={boundary:0,storage:0};return typeof w=="number"||typeof w=="boolean"?(b.boundary=4,b.storage=4):w.isVector2?(b.boundary=8,b.storage=8):w.isVector3||w.isColor?(b.boundary=16,b.storage=12):w.isVector4?(b.boundary=16,b.storage=16):w.isMatrix3?(b.boundary=48,b.storage=48):w.isMatrix4?(b.boundary=64,b.storage=64):w.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",w),b}function m(w){const b=w.target;b.removeEventListener("dispose",m);const M=o.indexOf(b.__bindingPointIndex);o.splice(M,1),i.deleteBuffer(s[b.id]),delete s[b.id],delete r[b.id]}function h(){for(const w in s)i.deleteBuffer(s[w]);o=[],s={},r={}}return{bind:l,update:c,dispose:h}}class Jm{constructor(e={}){const{canvas:t=Dh(),context:n=null,depth:s=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:d="default",failIfMajorPerformanceCaveat:f=!1,reverseDepthBuffer:u=!1}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=o;const g=new Uint32Array(4),x=new Int32Array(4);let m=null,h=null;const w=[],b=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=qt,this.toneMapping=Fn,this.toneMappingExposure=1;const M=this;let I=!1,P=0,A=0,U=null,S=-1,y=null;const C=new Qe,G=new Qe;let k=null;const $=new Ke(0);let j=0,X=t.width,Z=t.height,H=1,se=null,he=null;const ve=new Qe(0,0,X,Z),Ie=new Qe(0,0,X,Z);let et=!1;const W=new sa;let ee=!1,me=!1;this.transmissionResolutionScale=1;const re=new at,Me=new at,Te=new N,Ue=new Qe,ot={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let ze=!1;function ut(){return U===null?H:1}let T=n;function zt(v,L){return t.getContext(v,L)}try{const v={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:d,failIfMajorPerformanceCaveat:f};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Ko}`),t.addEventListener("webglcontextlost",Y,!1),t.addEventListener("webglcontextrestored",le,!1),t.addEventListener("webglcontextcreationerror",ae,!1),T===null){const L="webgl2";if(T=zt(L,v),T===null)throw zt(L)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(v){throw console.error("THREE.WebGLRenderer: "+v.message),v}let Oe,Be,ye,it,_e,E,_,F,q,K,V,ge,oe,ue,He,Q,de,Ee,be,fe,ke,Pe,nt,R;function ne(){Oe=new ap(T),Oe.init(),Pe=new Gm(T,Oe),Be=new tp(T,Oe,e,Pe),ye=new Hm(T,Oe),Be.reverseDepthBuffer&&u&&ye.buffers.depth.setReversed(!0),it=new hp(T),_e=new Cm,E=new Vm(T,Oe,ye,_e,Be,Pe,it),_=new ip(M),F=new op(M),q=new gu(T),nt=new Qf(T,q),K=new lp(T,q,it,nt),V=new dp(T,K,q,it),be=new up(T,Be,E),Q=new np(_e),ge=new Am(M,_,F,Oe,Be,nt,Q),oe=new Km(M,_e),ue=new Pm,He=new Fm(Oe),Ee=new Jf(M,_,F,ye,V,p,l),de=new km(M,V,Be),R=new Zm(T,it,Be,ye),fe=new ep(T,Oe,it),ke=new cp(T,Oe,it),it.programs=ge.programs,M.capabilities=Be,M.extensions=Oe,M.properties=_e,M.renderLists=ue,M.shadowMap=de,M.state=ye,M.info=it}ne();const z=new $m(M,T);this.xr=z,this.getContext=function(){return T},this.getContextAttributes=function(){return T.getContextAttributes()},this.forceContextLoss=function(){const v=Oe.get("WEBGL_lose_context");v&&v.loseContext()},this.forceContextRestore=function(){const v=Oe.get("WEBGL_lose_context");v&&v.restoreContext()},this.getPixelRatio=function(){return H},this.setPixelRatio=function(v){v!==void 0&&(H=v,this.setSize(X,Z,!1))},this.getSize=function(v){return v.set(X,Z)},this.setSize=function(v,L,O=!0){if(z.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}X=v,Z=L,t.width=Math.floor(v*H),t.height=Math.floor(L*H),O===!0&&(t.style.width=v+"px",t.style.height=L+"px"),this.setViewport(0,0,v,L)},this.getDrawingBufferSize=function(v){return v.set(X*H,Z*H).floor()},this.setDrawingBufferSize=function(v,L,O){X=v,Z=L,H=O,t.width=Math.floor(v*O),t.height=Math.floor(L*O),this.setViewport(0,0,v,L)},this.getCurrentViewport=function(v){return v.copy(C)},this.getViewport=function(v){return v.copy(ve)},this.setViewport=function(v,L,O,B){v.isVector4?ve.set(v.x,v.y,v.z,v.w):ve.set(v,L,O,B),ye.viewport(C.copy(ve).multiplyScalar(H).round())},this.getScissor=function(v){return v.copy(Ie)},this.setScissor=function(v,L,O,B){v.isVector4?Ie.set(v.x,v.y,v.z,v.w):Ie.set(v,L,O,B),ye.scissor(G.copy(Ie).multiplyScalar(H).round())},this.getScissorTest=function(){return et},this.setScissorTest=function(v){ye.setScissorTest(et=v)},this.setOpaqueSort=function(v){se=v},this.setTransparentSort=function(v){he=v},this.getClearColor=function(v){return v.copy(Ee.getClearColor())},this.setClearColor=function(){Ee.setClearColor.apply(Ee,arguments)},this.getClearAlpha=function(){return Ee.getClearAlpha()},this.setClearAlpha=function(){Ee.setClearAlpha.apply(Ee,arguments)},this.clear=function(v=!0,L=!0,O=!0){let B=0;if(v){let D=!1;if(U!==null){const J=U.texture.format;D=J===na||J===ta||J===ea}if(D){const J=U.texture.type,ie=J===En||J===li||J===hs||J===Hi||J===Jo||J===Qo,ce=Ee.getClearColor(),pe=Ee.getClearAlpha(),we=ce.r,Ae=ce.g,xe=ce.b;ie?(g[0]=we,g[1]=Ae,g[2]=xe,g[3]=pe,T.clearBufferuiv(T.COLOR,0,g)):(x[0]=we,x[1]=Ae,x[2]=xe,x[3]=pe,T.clearBufferiv(T.COLOR,0,x))}else B|=T.COLOR_BUFFER_BIT}L&&(B|=T.DEPTH_BUFFER_BIT),O&&(B|=T.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),T.clear(B)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",Y,!1),t.removeEventListener("webglcontextrestored",le,!1),t.removeEventListener("webglcontextcreationerror",ae,!1),Ee.dispose(),ue.dispose(),He.dispose(),_e.dispose(),_.dispose(),F.dispose(),V.dispose(),nt.dispose(),R.dispose(),ge.dispose(),z.dispose(),z.removeEventListener("sessionstart",fa),z.removeEventListener("sessionend",pa),zn.stop()};function Y(v){v.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),I=!0}function le(){console.log("THREE.WebGLRenderer: Context Restored."),I=!1;const v=it.autoReset,L=de.enabled,O=de.autoUpdate,B=de.needsUpdate,D=de.type;ne(),it.autoReset=v,de.enabled=L,de.autoUpdate=O,de.needsUpdate=B,de.type=D}function ae(v){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",v.statusMessage)}function Ce(v){const L=v.target;L.removeEventListener("dispose",Ce),lt(L)}function lt(v){xt(v),_e.remove(v)}function xt(v){const L=_e.get(v).programs;L!==void 0&&(L.forEach(function(O){ge.releaseProgram(O)}),v.isShaderMaterial&&ge.releaseShaderCache(v))}this.renderBufferDirect=function(v,L,O,B,D,J){L===null&&(L=ot);const ie=D.isMesh&&D.matrixWorld.determinant()<0,ce=Oc(v,L,O,B,D);ye.setMaterial(B,ie);let pe=O.index,we=1;if(B.wireframe===!0){if(pe=K.getWireframeAttribute(O),pe===void 0)return;we=2}const Ae=O.drawRange,xe=O.attributes.position;let Ve=Ae.start*we,qe=(Ae.start+Ae.count)*we;J!==null&&(Ve=Math.max(Ve,J.start*we),qe=Math.min(qe,(J.start+J.count)*we)),pe!==null?(Ve=Math.max(Ve,0),qe=Math.min(qe,pe.count)):xe!=null&&(Ve=Math.max(Ve,0),qe=Math.min(qe,xe.count));const dt=qe-Ve;if(dt<0||dt===1/0)return;nt.setup(D,B,ce,O,pe);let ct,We=fe;if(pe!==null&&(ct=q.get(pe),We=ke,We.setIndex(ct)),D.isMesh)B.wireframe===!0?(ye.setLineWidth(B.wireframeLinewidth*ut()),We.setMode(T.LINES)):We.setMode(T.TRIANGLES);else if(D.isLine){let Se=B.linewidth;Se===void 0&&(Se=1),ye.setLineWidth(Se*ut()),D.isLineSegments?We.setMode(T.LINES):D.isLineLoop?We.setMode(T.LINE_LOOP):We.setMode(T.LINE_STRIP)}else D.isPoints?We.setMode(T.POINTS):D.isSprite&&We.setMode(T.TRIANGLES);if(D.isBatchedMesh)if(D._multiDrawInstances!==null)We.renderMultiDrawInstances(D._multiDrawStarts,D._multiDrawCounts,D._multiDrawCount,D._multiDrawInstances);else if(Oe.get("WEBGL_multi_draw"))We.renderMultiDraw(D._multiDrawStarts,D._multiDrawCounts,D._multiDrawCount);else{const Se=D._multiDrawStarts,vt=D._multiDrawCounts,Ye=D._multiDrawCount,jt=pe?q.get(pe).bytesPerElement:1,ui=_e.get(B).currentProgram.getUniforms();for(let Ut=0;Ut<Ye;Ut++)ui.setValue(T,"_gl_DrawID",Ut),We.render(Se[Ut]/jt,vt[Ut])}else if(D.isInstancedMesh)We.renderInstances(Ve,dt,D.count);else if(O.isInstancedBufferGeometry){const Se=O._maxInstanceCount!==void 0?O._maxInstanceCount:1/0,vt=Math.min(O.instanceCount,Se);We.renderInstances(Ve,dt,vt)}else We.render(Ve,dt)};function je(v,L,O){v.transparent===!0&&v.side===_n&&v.forceSinglePass===!1?(v.side=Lt,v.needsUpdate=!0,vs(v,L,O),v.side=Bn,v.needsUpdate=!0,vs(v,L,O),v.side=_n):vs(v,L,O)}this.compile=function(v,L,O=null){O===null&&(O=v),h=He.get(O),h.init(L),b.push(h),O.traverseVisible(function(D){D.isLight&&D.layers.test(L.layers)&&(h.pushLight(D),D.castShadow&&h.pushShadow(D))}),v!==O&&v.traverseVisible(function(D){D.isLight&&D.layers.test(L.layers)&&(h.pushLight(D),D.castShadow&&h.pushShadow(D))}),h.setupLights();const B=new Set;return v.traverse(function(D){if(!(D.isMesh||D.isPoints||D.isLine||D.isSprite))return;const J=D.material;if(J)if(Array.isArray(J))for(let ie=0;ie<J.length;ie++){const ce=J[ie];je(ce,O,D),B.add(ce)}else je(J,O,D),B.add(J)}),b.pop(),h=null,B},this.compileAsync=function(v,L,O=null){const B=this.compile(v,L,O);return new Promise(D=>{function J(){if(B.forEach(function(ie){_e.get(ie).currentProgram.isReady()&&B.delete(ie)}),B.size===0){D(v);return}setTimeout(J,10)}Oe.get("KHR_parallel_shader_compile")!==null?J():setTimeout(J,10)})};let $t=null;function cn(v){$t&&$t(v)}function fa(){zn.stop()}function pa(){zn.start()}const zn=new _c;zn.setAnimationLoop(cn),typeof self<"u"&&zn.setContext(self),this.setAnimationLoop=function(v){$t=v,z.setAnimationLoop(v),v===null?zn.stop():zn.start()},z.addEventListener("sessionstart",fa),z.addEventListener("sessionend",pa),this.render=function(v,L){if(L!==void 0&&L.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(I===!0)return;if(v.matrixWorldAutoUpdate===!0&&v.updateMatrixWorld(),L.parent===null&&L.matrixWorldAutoUpdate===!0&&L.updateMatrixWorld(),z.enabled===!0&&z.isPresenting===!0&&(z.cameraAutoUpdate===!0&&z.updateCamera(L),L=z.getCamera()),v.isScene===!0&&v.onBeforeRender(M,v,L,U),h=He.get(v,b.length),h.init(L),b.push(h),Me.multiplyMatrices(L.projectionMatrix,L.matrixWorldInverse),W.setFromProjectionMatrix(Me),me=this.localClippingEnabled,ee=Q.init(this.clippingPlanes,me),m=ue.get(v,w.length),m.init(),w.push(m),z.enabled===!0&&z.isPresenting===!0){const J=M.xr.getDepthSensingMesh();J!==null&&hr(J,L,-1/0,M.sortObjects)}hr(v,L,0,M.sortObjects),m.finish(),M.sortObjects===!0&&m.sort(se,he),ze=z.enabled===!1||z.isPresenting===!1||z.hasDepthSensing()===!1,ze&&Ee.addToRenderList(m,v),this.info.render.frame++,ee===!0&&Q.beginShadows();const O=h.state.shadowsArray;de.render(O,v,L),ee===!0&&Q.endShadows(),this.info.autoReset===!0&&this.info.reset();const B=m.opaque,D=m.transmissive;if(h.setupLights(),L.isArrayCamera){const J=L.cameras;if(D.length>0)for(let ie=0,ce=J.length;ie<ce;ie++){const pe=J[ie];ga(B,D,v,pe)}ze&&Ee.render(v);for(let ie=0,ce=J.length;ie<ce;ie++){const pe=J[ie];ma(m,v,pe,pe.viewport)}}else D.length>0&&ga(B,D,v,L),ze&&Ee.render(v),ma(m,v,L);U!==null&&A===0&&(E.updateMultisampleRenderTarget(U),E.updateRenderTargetMipmap(U)),v.isScene===!0&&v.onAfterRender(M,v,L),nt.resetDefaultState(),S=-1,y=null,b.pop(),b.length>0?(h=b[b.length-1],ee===!0&&Q.setGlobalState(M.clippingPlanes,h.state.camera)):h=null,w.pop(),w.length>0?m=w[w.length-1]:m=null};function hr(v,L,O,B){if(v.visible===!1)return;if(v.layers.test(L.layers)){if(v.isGroup)O=v.renderOrder;else if(v.isLOD)v.autoUpdate===!0&&v.update(L);else if(v.isLight)h.pushLight(v),v.castShadow&&h.pushShadow(v);else if(v.isSprite){if(!v.frustumCulled||W.intersectsSprite(v)){B&&Ue.setFromMatrixPosition(v.matrixWorld).applyMatrix4(Me);const ie=V.update(v),ce=v.material;ce.visible&&m.push(v,ie,ce,O,Ue.z,null)}}else if((v.isMesh||v.isLine||v.isPoints)&&(!v.frustumCulled||W.intersectsObject(v))){const ie=V.update(v),ce=v.material;if(B&&(v.boundingSphere!==void 0?(v.boundingSphere===null&&v.computeBoundingSphere(),Ue.copy(v.boundingSphere.center)):(ie.boundingSphere===null&&ie.computeBoundingSphere(),Ue.copy(ie.boundingSphere.center)),Ue.applyMatrix4(v.matrixWorld).applyMatrix4(Me)),Array.isArray(ce)){const pe=ie.groups;for(let we=0,Ae=pe.length;we<Ae;we++){const xe=pe[we],Ve=ce[xe.materialIndex];Ve&&Ve.visible&&m.push(v,ie,Ve,O,Ue.z,xe)}}else ce.visible&&m.push(v,ie,ce,O,Ue.z,null)}}const J=v.children;for(let ie=0,ce=J.length;ie<ce;ie++)hr(J[ie],L,O,B)}function ma(v,L,O,B){const D=v.opaque,J=v.transmissive,ie=v.transparent;h.setupLightsView(O),ee===!0&&Q.setGlobalState(M.clippingPlanes,O),B&&ye.viewport(C.copy(B)),D.length>0&&_s(D,L,O),J.length>0&&_s(J,L,O),ie.length>0&&_s(ie,L,O),ye.buffers.depth.setTest(!0),ye.buffers.depth.setMask(!0),ye.buffers.color.setMask(!0),ye.setPolygonOffset(!1)}function ga(v,L,O,B){if((O.isScene===!0?O.overrideMaterial:null)!==null)return;h.state.transmissionRenderTarget[B.id]===void 0&&(h.state.transmissionRenderTarget[B.id]=new ci(1,1,{generateMipmaps:!0,type:Oe.has("EXT_color_buffer_half_float")||Oe.has("EXT_color_buffer_float")?ds:En,minFilter:ii,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Xe.workingColorSpace}));const J=h.state.transmissionRenderTarget[B.id],ie=B.viewport||C;J.setSize(ie.z*M.transmissionResolutionScale,ie.w*M.transmissionResolutionScale);const ce=M.getRenderTarget();M.setRenderTarget(J),M.getClearColor($),j=M.getClearAlpha(),j<1&&M.setClearColor(16777215,.5),M.clear(),ze&&Ee.render(O);const pe=M.toneMapping;M.toneMapping=Fn;const we=B.viewport;if(B.viewport!==void 0&&(B.viewport=void 0),h.setupLightsView(B),ee===!0&&Q.setGlobalState(M.clippingPlanes,B),_s(v,O,B),E.updateMultisampleRenderTarget(J),E.updateRenderTargetMipmap(J),Oe.has("WEBGL_multisampled_render_to_texture")===!1){let Ae=!1;for(let xe=0,Ve=L.length;xe<Ve;xe++){const qe=L[xe],dt=qe.object,ct=qe.geometry,We=qe.material,Se=qe.group;if(We.side===_n&&dt.layers.test(B.layers)){const vt=We.side;We.side=Lt,We.needsUpdate=!0,_a(dt,O,B,ct,We,Se),We.side=vt,We.needsUpdate=!0,Ae=!0}}Ae===!0&&(E.updateMultisampleRenderTarget(J),E.updateRenderTargetMipmap(J))}M.setRenderTarget(ce),M.setClearColor($,j),we!==void 0&&(B.viewport=we),M.toneMapping=pe}function _s(v,L,O){const B=L.isScene===!0?L.overrideMaterial:null;for(let D=0,J=v.length;D<J;D++){const ie=v[D],ce=ie.object,pe=ie.geometry,we=B===null?ie.material:B,Ae=ie.group;ce.layers.test(O.layers)&&_a(ce,L,O,pe,we,Ae)}}function _a(v,L,O,B,D,J){v.onBeforeRender(M,L,O,B,D,J),v.modelViewMatrix.multiplyMatrices(O.matrixWorldInverse,v.matrixWorld),v.normalMatrix.getNormalMatrix(v.modelViewMatrix),D.onBeforeRender(M,L,O,B,v,J),D.transparent===!0&&D.side===_n&&D.forceSinglePass===!1?(D.side=Lt,D.needsUpdate=!0,M.renderBufferDirect(O,L,B,D,v,J),D.side=Bn,D.needsUpdate=!0,M.renderBufferDirect(O,L,B,D,v,J),D.side=_n):M.renderBufferDirect(O,L,B,D,v,J),v.onAfterRender(M,L,O,B,D,J)}function vs(v,L,O){L.isScene!==!0&&(L=ot);const B=_e.get(v),D=h.state.lights,J=h.state.shadowsArray,ie=D.state.version,ce=ge.getParameters(v,D.state,J,L,O),pe=ge.getProgramCacheKey(ce);let we=B.programs;B.environment=v.isMeshStandardMaterial?L.environment:null,B.fog=L.fog,B.envMap=(v.isMeshStandardMaterial?F:_).get(v.envMap||B.environment),B.envMapRotation=B.environment!==null&&v.envMap===null?L.environmentRotation:v.envMapRotation,we===void 0&&(v.addEventListener("dispose",Ce),we=new Map,B.programs=we);let Ae=we.get(pe);if(Ae!==void 0){if(B.currentProgram===Ae&&B.lightsStateVersion===ie)return ya(v,ce),Ae}else ce.uniforms=ge.getUniforms(v),v.onBeforeCompile(ce,M),Ae=ge.acquireProgram(ce,pe),we.set(pe,Ae),B.uniforms=ce.uniforms;const xe=B.uniforms;return(!v.isShaderMaterial&&!v.isRawShaderMaterial||v.clipping===!0)&&(xe.clippingPlanes=Q.uniform),ya(v,ce),B.needsLights=kc(v),B.lightsStateVersion=ie,B.needsLights&&(xe.ambientLightColor.value=D.state.ambient,xe.lightProbe.value=D.state.probe,xe.directionalLights.value=D.state.directional,xe.directionalLightShadows.value=D.state.directionalShadow,xe.spotLights.value=D.state.spot,xe.spotLightShadows.value=D.state.spotShadow,xe.rectAreaLights.value=D.state.rectArea,xe.ltc_1.value=D.state.rectAreaLTC1,xe.ltc_2.value=D.state.rectAreaLTC2,xe.pointLights.value=D.state.point,xe.pointLightShadows.value=D.state.pointShadow,xe.hemisphereLights.value=D.state.hemi,xe.directionalShadowMap.value=D.state.directionalShadowMap,xe.directionalShadowMatrix.value=D.state.directionalShadowMatrix,xe.spotShadowMap.value=D.state.spotShadowMap,xe.spotLightMatrix.value=D.state.spotLightMatrix,xe.spotLightMap.value=D.state.spotLightMap,xe.pointShadowMap.value=D.state.pointShadowMap,xe.pointShadowMatrix.value=D.state.pointShadowMatrix),B.currentProgram=Ae,B.uniformsList=null,Ae}function va(v){if(v.uniformsList===null){const L=v.currentProgram.getUniforms();v.uniformsList=$s.seqWithValue(L.seq,v.uniforms)}return v.uniformsList}function ya(v,L){const O=_e.get(v);O.outputColorSpace=L.outputColorSpace,O.batching=L.batching,O.batchingColor=L.batchingColor,O.instancing=L.instancing,O.instancingColor=L.instancingColor,O.instancingMorph=L.instancingMorph,O.skinning=L.skinning,O.morphTargets=L.morphTargets,O.morphNormals=L.morphNormals,O.morphColors=L.morphColors,O.morphTargetsCount=L.morphTargetsCount,O.numClippingPlanes=L.numClippingPlanes,O.numIntersection=L.numClipIntersection,O.vertexAlphas=L.vertexAlphas,O.vertexTangents=L.vertexTangents,O.toneMapping=L.toneMapping}function Oc(v,L,O,B,D){L.isScene!==!0&&(L=ot),E.resetTextureUnits();const J=L.fog,ie=B.isMeshStandardMaterial?L.environment:null,ce=U===null?M.outputColorSpace:U.isXRRenderTarget===!0?U.texture.colorSpace:Gi,pe=(B.isMeshStandardMaterial?F:_).get(B.envMap||ie),we=B.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,Ae=!!O.attributes.tangent&&(!!B.normalMap||B.anisotropy>0),xe=!!O.morphAttributes.position,Ve=!!O.morphAttributes.normal,qe=!!O.morphAttributes.color;let dt=Fn;B.toneMapped&&(U===null||U.isXRRenderTarget===!0)&&(dt=M.toneMapping);const ct=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,We=ct!==void 0?ct.length:0,Se=_e.get(B),vt=h.state.lights;if(ee===!0&&(me===!0||v!==y)){const Mt=v===y&&B.id===S;Q.setState(B,v,Mt)}let Ye=!1;B.version===Se.__version?(Se.needsLights&&Se.lightsStateVersion!==vt.state.version||Se.outputColorSpace!==ce||D.isBatchedMesh&&Se.batching===!1||!D.isBatchedMesh&&Se.batching===!0||D.isBatchedMesh&&Se.batchingColor===!0&&D.colorTexture===null||D.isBatchedMesh&&Se.batchingColor===!1&&D.colorTexture!==null||D.isInstancedMesh&&Se.instancing===!1||!D.isInstancedMesh&&Se.instancing===!0||D.isSkinnedMesh&&Se.skinning===!1||!D.isSkinnedMesh&&Se.skinning===!0||D.isInstancedMesh&&Se.instancingColor===!0&&D.instanceColor===null||D.isInstancedMesh&&Se.instancingColor===!1&&D.instanceColor!==null||D.isInstancedMesh&&Se.instancingMorph===!0&&D.morphTexture===null||D.isInstancedMesh&&Se.instancingMorph===!1&&D.morphTexture!==null||Se.envMap!==pe||B.fog===!0&&Se.fog!==J||Se.numClippingPlanes!==void 0&&(Se.numClippingPlanes!==Q.numPlanes||Se.numIntersection!==Q.numIntersection)||Se.vertexAlphas!==we||Se.vertexTangents!==Ae||Se.morphTargets!==xe||Se.morphNormals!==Ve||Se.morphColors!==qe||Se.toneMapping!==dt||Se.morphTargetsCount!==We)&&(Ye=!0):(Ye=!0,Se.__version=B.version);let jt=Se.currentProgram;Ye===!0&&(jt=vs(B,L,D));let ui=!1,Ut=!1,ji=!1;const rt=jt.getUniforms(),Ht=Se.uniforms;if(ye.useProgram(jt.program)&&(ui=!0,Ut=!0,ji=!0),B.id!==S&&(S=B.id,Ut=!0),ui||y!==v){ye.buffers.depth.getReversed()?(re.copy(v.projectionMatrix),Uh(re),Nh(re),rt.setValue(T,"projectionMatrix",re)):rt.setValue(T,"projectionMatrix",v.projectionMatrix),rt.setValue(T,"viewMatrix",v.matrixWorldInverse);const At=rt.map.cameraPosition;At!==void 0&&At.setValue(T,Te.setFromMatrixPosition(v.matrixWorld)),Be.logarithmicDepthBuffer&&rt.setValue(T,"logDepthBufFC",2/(Math.log(v.far+1)/Math.LN2)),(B.isMeshPhongMaterial||B.isMeshToonMaterial||B.isMeshLambertMaterial||B.isMeshBasicMaterial||B.isMeshStandardMaterial||B.isShaderMaterial)&&rt.setValue(T,"isOrthographic",v.isOrthographicCamera===!0),y!==v&&(y=v,Ut=!0,ji=!0)}if(D.isSkinnedMesh){rt.setOptional(T,D,"bindMatrix"),rt.setOptional(T,D,"bindMatrixInverse");const Mt=D.skeleton;Mt&&(Mt.boneTexture===null&&Mt.computeBoneTexture(),rt.setValue(T,"boneTexture",Mt.boneTexture,E))}D.isBatchedMesh&&(rt.setOptional(T,D,"batchingTexture"),rt.setValue(T,"batchingTexture",D._matricesTexture,E),rt.setOptional(T,D,"batchingIdTexture"),rt.setValue(T,"batchingIdTexture",D._indirectTexture,E),rt.setOptional(T,D,"batchingColorTexture"),D._colorsTexture!==null&&rt.setValue(T,"batchingColorTexture",D._colorsTexture,E));const Vt=O.morphAttributes;if((Vt.position!==void 0||Vt.normal!==void 0||Vt.color!==void 0)&&be.update(D,O,jt),(Ut||Se.receiveShadow!==D.receiveShadow)&&(Se.receiveShadow=D.receiveShadow,rt.setValue(T,"receiveShadow",D.receiveShadow)),B.isMeshGouraudMaterial&&B.envMap!==null&&(Ht.envMap.value=pe,Ht.flipEnvMap.value=pe.isCubeTexture&&pe.isRenderTargetTexture===!1?-1:1),B.isMeshStandardMaterial&&B.envMap===null&&L.environment!==null&&(Ht.envMapIntensity.value=L.environmentIntensity),Ut&&(rt.setValue(T,"toneMappingExposure",M.toneMappingExposure),Se.needsLights&&Bc(Ht,ji),J&&B.fog===!0&&oe.refreshFogUniforms(Ht,J),oe.refreshMaterialUniforms(Ht,B,H,Z,h.state.transmissionRenderTarget[v.id]),$s.upload(T,va(Se),Ht,E)),B.isShaderMaterial&&B.uniformsNeedUpdate===!0&&($s.upload(T,va(Se),Ht,E),B.uniformsNeedUpdate=!1),B.isSpriteMaterial&&rt.setValue(T,"center",D.center),rt.setValue(T,"modelViewMatrix",D.modelViewMatrix),rt.setValue(T,"normalMatrix",D.normalMatrix),rt.setValue(T,"modelMatrix",D.matrixWorld),B.isShaderMaterial||B.isRawShaderMaterial){const Mt=B.uniformsGroups;for(let At=0,ur=Mt.length;At<ur;At++){const Hn=Mt[At];R.update(Hn,jt),R.bind(Hn,jt)}}return jt}function Bc(v,L){v.ambientLightColor.needsUpdate=L,v.lightProbe.needsUpdate=L,v.directionalLights.needsUpdate=L,v.directionalLightShadows.needsUpdate=L,v.pointLights.needsUpdate=L,v.pointLightShadows.needsUpdate=L,v.spotLights.needsUpdate=L,v.spotLightShadows.needsUpdate=L,v.rectAreaLights.needsUpdate=L,v.hemisphereLights.needsUpdate=L}function kc(v){return v.isMeshLambertMaterial||v.isMeshToonMaterial||v.isMeshPhongMaterial||v.isMeshStandardMaterial||v.isShadowMaterial||v.isShaderMaterial&&v.lights===!0}this.getActiveCubeFace=function(){return P},this.getActiveMipmapLevel=function(){return A},this.getRenderTarget=function(){return U},this.setRenderTargetTextures=function(v,L,O){_e.get(v.texture).__webglTexture=L,_e.get(v.depthTexture).__webglTexture=O;const B=_e.get(v);B.__hasExternalTextures=!0,B.__autoAllocateDepthBuffer=O===void 0,B.__autoAllocateDepthBuffer||Oe.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),B.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(v,L){const O=_e.get(v);O.__webglFramebuffer=L,O.__useDefaultFramebuffer=L===void 0};const zc=T.createFramebuffer();this.setRenderTarget=function(v,L=0,O=0){U=v,P=L,A=O;let B=!0,D=null,J=!1,ie=!1;if(v){const pe=_e.get(v);if(pe.__useDefaultFramebuffer!==void 0)ye.bindFramebuffer(T.FRAMEBUFFER,null),B=!1;else if(pe.__webglFramebuffer===void 0)E.setupRenderTarget(v);else if(pe.__hasExternalTextures)E.rebindTextures(v,_e.get(v.texture).__webglTexture,_e.get(v.depthTexture).__webglTexture);else if(v.depthBuffer){const xe=v.depthTexture;if(pe.__boundDepthTexture!==xe){if(xe!==null&&_e.has(xe)&&(v.width!==xe.image.width||v.height!==xe.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");E.setupDepthRenderbuffer(v)}}const we=v.texture;(we.isData3DTexture||we.isDataArrayTexture||we.isCompressedArrayTexture)&&(ie=!0);const Ae=_e.get(v).__webglFramebuffer;v.isWebGLCubeRenderTarget?(Array.isArray(Ae[L])?D=Ae[L][O]:D=Ae[L],J=!0):v.samples>0&&E.useMultisampledRTT(v)===!1?D=_e.get(v).__webglMultisampledFramebuffer:Array.isArray(Ae)?D=Ae[O]:D=Ae,C.copy(v.viewport),G.copy(v.scissor),k=v.scissorTest}else C.copy(ve).multiplyScalar(H).floor(),G.copy(Ie).multiplyScalar(H).floor(),k=et;if(O!==0&&(D=zc),ye.bindFramebuffer(T.FRAMEBUFFER,D)&&B&&ye.drawBuffers(v,D),ye.viewport(C),ye.scissor(G),ye.setScissorTest(k),J){const pe=_e.get(v.texture);T.framebufferTexture2D(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_CUBE_MAP_POSITIVE_X+L,pe.__webglTexture,O)}else if(ie){const pe=_e.get(v.texture),we=L;T.framebufferTextureLayer(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,pe.__webglTexture,O,we)}else if(v!==null&&O!==0){const pe=_e.get(v.texture);T.framebufferTexture2D(T.FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,pe.__webglTexture,O)}S=-1},this.readRenderTargetPixels=function(v,L,O,B,D,J,ie){if(!(v&&v.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ce=_e.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&ie!==void 0&&(ce=ce[ie]),ce){ye.bindFramebuffer(T.FRAMEBUFFER,ce);try{const pe=v.texture,we=pe.format,Ae=pe.type;if(!Be.textureFormatReadable(we)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Be.textureTypeReadable(Ae)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}L>=0&&L<=v.width-B&&O>=0&&O<=v.height-D&&T.readPixels(L,O,B,D,Pe.convert(we),Pe.convert(Ae),J)}finally{const pe=U!==null?_e.get(U).__webglFramebuffer:null;ye.bindFramebuffer(T.FRAMEBUFFER,pe)}}},this.readRenderTargetPixelsAsync=async function(v,L,O,B,D,J,ie){if(!(v&&v.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ce=_e.get(v).__webglFramebuffer;if(v.isWebGLCubeRenderTarget&&ie!==void 0&&(ce=ce[ie]),ce){const pe=v.texture,we=pe.format,Ae=pe.type;if(!Be.textureFormatReadable(we))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Be.textureTypeReadable(Ae))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(L>=0&&L<=v.width-B&&O>=0&&O<=v.height-D){ye.bindFramebuffer(T.FRAMEBUFFER,ce);const xe=T.createBuffer();T.bindBuffer(T.PIXEL_PACK_BUFFER,xe),T.bufferData(T.PIXEL_PACK_BUFFER,J.byteLength,T.STREAM_READ),T.readPixels(L,O,B,D,Pe.convert(we),Pe.convert(Ae),0);const Ve=U!==null?_e.get(U).__webglFramebuffer:null;ye.bindFramebuffer(T.FRAMEBUFFER,Ve);const qe=T.fenceSync(T.SYNC_GPU_COMMANDS_COMPLETE,0);return T.flush(),await Ih(T,qe,4),T.bindBuffer(T.PIXEL_PACK_BUFFER,xe),T.getBufferSubData(T.PIXEL_PACK_BUFFER,0,J),T.deleteBuffer(xe),T.deleteSync(qe),J}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(v,L=null,O=0){v.isTexture!==!0&&(Ri("WebGLRenderer: copyFramebufferToTexture function signature has changed."),L=arguments[0]||null,v=arguments[1]);const B=Math.pow(2,-O),D=Math.floor(v.image.width*B),J=Math.floor(v.image.height*B),ie=L!==null?L.x:0,ce=L!==null?L.y:0;E.setTexture2D(v,0),T.copyTexSubImage2D(T.TEXTURE_2D,O,0,0,ie,ce,D,J),ye.unbindTexture()};const Hc=T.createFramebuffer(),Vc=T.createFramebuffer();this.copyTextureToTexture=function(v,L,O=null,B=null,D=0,J=null){v.isTexture!==!0&&(Ri("WebGLRenderer: copyTextureToTexture function signature has changed."),B=arguments[0]||null,v=arguments[1],L=arguments[2],J=arguments[3]||0,O=null),J===null&&(D!==0?(Ri("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),J=D,D=0):J=0);let ie,ce,pe,we,Ae,xe,Ve,qe,dt;const ct=v.isCompressedTexture?v.mipmaps[J]:v.image;if(O!==null)ie=O.max.x-O.min.x,ce=O.max.y-O.min.y,pe=O.isBox3?O.max.z-O.min.z:1,we=O.min.x,Ae=O.min.y,xe=O.isBox3?O.min.z:0;else{const Vt=Math.pow(2,-D);ie=Math.floor(ct.width*Vt),ce=Math.floor(ct.height*Vt),v.isDataArrayTexture?pe=ct.depth:v.isData3DTexture?pe=Math.floor(ct.depth*Vt):pe=1,we=0,Ae=0,xe=0}B!==null?(Ve=B.x,qe=B.y,dt=B.z):(Ve=0,qe=0,dt=0);const We=Pe.convert(L.format),Se=Pe.convert(L.type);let vt;L.isData3DTexture?(E.setTexture3D(L,0),vt=T.TEXTURE_3D):L.isDataArrayTexture||L.isCompressedArrayTexture?(E.setTexture2DArray(L,0),vt=T.TEXTURE_2D_ARRAY):(E.setTexture2D(L,0),vt=T.TEXTURE_2D),T.pixelStorei(T.UNPACK_FLIP_Y_WEBGL,L.flipY),T.pixelStorei(T.UNPACK_PREMULTIPLY_ALPHA_WEBGL,L.premultiplyAlpha),T.pixelStorei(T.UNPACK_ALIGNMENT,L.unpackAlignment);const Ye=T.getParameter(T.UNPACK_ROW_LENGTH),jt=T.getParameter(T.UNPACK_IMAGE_HEIGHT),ui=T.getParameter(T.UNPACK_SKIP_PIXELS),Ut=T.getParameter(T.UNPACK_SKIP_ROWS),ji=T.getParameter(T.UNPACK_SKIP_IMAGES);T.pixelStorei(T.UNPACK_ROW_LENGTH,ct.width),T.pixelStorei(T.UNPACK_IMAGE_HEIGHT,ct.height),T.pixelStorei(T.UNPACK_SKIP_PIXELS,we),T.pixelStorei(T.UNPACK_SKIP_ROWS,Ae),T.pixelStorei(T.UNPACK_SKIP_IMAGES,xe);const rt=v.isDataArrayTexture||v.isData3DTexture,Ht=L.isDataArrayTexture||L.isData3DTexture;if(v.isDepthTexture){const Vt=_e.get(v),Mt=_e.get(L),At=_e.get(Vt.__renderTarget),ur=_e.get(Mt.__renderTarget);ye.bindFramebuffer(T.READ_FRAMEBUFFER,At.__webglFramebuffer),ye.bindFramebuffer(T.DRAW_FRAMEBUFFER,ur.__webglFramebuffer);for(let Hn=0;Hn<pe;Hn++)rt&&(T.framebufferTextureLayer(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,_e.get(v).__webglTexture,D,xe+Hn),T.framebufferTextureLayer(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,_e.get(L).__webglTexture,J,dt+Hn)),T.blitFramebuffer(we,Ae,ie,ce,Ve,qe,ie,ce,T.DEPTH_BUFFER_BIT,T.NEAREST);ye.bindFramebuffer(T.READ_FRAMEBUFFER,null),ye.bindFramebuffer(T.DRAW_FRAMEBUFFER,null)}else if(D!==0||v.isRenderTargetTexture||_e.has(v)){const Vt=_e.get(v),Mt=_e.get(L);ye.bindFramebuffer(T.READ_FRAMEBUFFER,Hc),ye.bindFramebuffer(T.DRAW_FRAMEBUFFER,Vc);for(let At=0;At<pe;At++)rt?T.framebufferTextureLayer(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,Vt.__webglTexture,D,xe+At):T.framebufferTexture2D(T.READ_FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,Vt.__webglTexture,D),Ht?T.framebufferTextureLayer(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,Mt.__webglTexture,J,dt+At):T.framebufferTexture2D(T.DRAW_FRAMEBUFFER,T.COLOR_ATTACHMENT0,T.TEXTURE_2D,Mt.__webglTexture,J),D!==0?T.blitFramebuffer(we,Ae,ie,ce,Ve,qe,ie,ce,T.COLOR_BUFFER_BIT,T.NEAREST):Ht?T.copyTexSubImage3D(vt,J,Ve,qe,dt+At,we,Ae,ie,ce):T.copyTexSubImage2D(vt,J,Ve,qe,we,Ae,ie,ce);ye.bindFramebuffer(T.READ_FRAMEBUFFER,null),ye.bindFramebuffer(T.DRAW_FRAMEBUFFER,null)}else Ht?v.isDataTexture||v.isData3DTexture?T.texSubImage3D(vt,J,Ve,qe,dt,ie,ce,pe,We,Se,ct.data):L.isCompressedArrayTexture?T.compressedTexSubImage3D(vt,J,Ve,qe,dt,ie,ce,pe,We,ct.data):T.texSubImage3D(vt,J,Ve,qe,dt,ie,ce,pe,We,Se,ct):v.isDataTexture?T.texSubImage2D(T.TEXTURE_2D,J,Ve,qe,ie,ce,We,Se,ct.data):v.isCompressedTexture?T.compressedTexSubImage2D(T.TEXTURE_2D,J,Ve,qe,ct.width,ct.height,We,ct.data):T.texSubImage2D(T.TEXTURE_2D,J,Ve,qe,ie,ce,We,Se,ct);T.pixelStorei(T.UNPACK_ROW_LENGTH,Ye),T.pixelStorei(T.UNPACK_IMAGE_HEIGHT,jt),T.pixelStorei(T.UNPACK_SKIP_PIXELS,ui),T.pixelStorei(T.UNPACK_SKIP_ROWS,Ut),T.pixelStorei(T.UNPACK_SKIP_IMAGES,ji),J===0&&L.generateMipmaps&&T.generateMipmap(vt),ye.unbindTexture()},this.copyTextureToTexture3D=function(v,L,O=null,B=null,D=0){return v.isTexture!==!0&&(Ri("WebGLRenderer: copyTextureToTexture3D function signature has changed."),O=arguments[0]||null,B=arguments[1]||null,v=arguments[2],L=arguments[3],D=arguments[4]||0),Ri('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(v,L,O,B,D)},this.initRenderTarget=function(v){_e.get(v).__webglFramebuffer===void 0&&E.setupRenderTarget(v)},this.initTexture=function(v){v.isCubeTexture?E.setTextureCube(v,0):v.isData3DTexture?E.setTexture3D(v,0):v.isDataArrayTexture||v.isCompressedArrayTexture?E.setTexture2DArray(v,0):E.setTexture2D(v,0),ye.unbindTexture()},this.resetState=function(){P=0,A=0,U=null,ye.reset(),nt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return yn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorspace=Xe._getDrawingBufferColorSpace(e),t.unpackColorSpace=Xe._getUnpackColorSpace()}}class Qm{constructor(e=1800){this.baseWidth=e,this.baseHeight=2700,this.contentWidth=e,this.camera=new Bt(45,e/2700,1,25e3),this._updatePosition()}_updatePosition(){const e=this.contentWidth/2,t=-this.baseHeight/2,n=45*Math.PI/180,s=this.baseHeight/2/Math.tan(n/2);this.camera.position.set(e,t+Math.sin(.14)*s*.3,s),this.camera.lookAt(e,t,0)}resize(e,t,n){this.baseWidth=e,this.baseHeight=t,this.contentWidth=n||e,this.camera.aspect=e/t,this.camera.updateProjectionMatrix(),this._updatePosition()}}const eg=1350;class tg{constructor(e){this._cx=e/2,this.domElement=document.createElement("div"),this.domElement.id="dom-ui-container",this.domElement.style.cssText="position:fixed;top:50%;left:50%;width:0;height:0;overflow:visible;pointer-events:none;z-index:1;",this._scaleEl=document.createElement("div"),this._scaleEl.style.transformOrigin="0 0",this.domElement.appendChild(this._scaleEl),this._groupEl=document.createElement("div"),this._groupEl.id="dom-bubble-group",this._scaleEl.appendChild(this._groupEl)}resize(e){this._scaleEl.style.transform=`scale(${e.scale})`}add(e){e.style.position="absolute",e.style.left="0",e.style.top="0",this._scaleEl.appendChild(e)}addToGroup(e){e.style.position="absolute",e.style.left="0",e.style.top="0",this._groupEl.appendChild(e)}remove(e){e&&e.parentNode&&e.parentNode.removeChild(e)}setGroupY(e){this._groupEl.style.transform=`translateY(${-e}px)`}transform(e,t,n=0,s=0,r=0){const o=e-this._cx,a=-(t+eg);let l=`translate(-50%,-50%) translate3d(${o}px,${a}px,${n}px)`;return Math.abs(s)>5e-4&&(l+=` rotateX(${-s}rad)`),Math.abs(r)>5e-4&&(l+=` rotateY(${r}rad)`),l}applyTransform(e,t,n,s=0,r=0,o=0){e.style.transform=this.transform(t,n,s,r,o)}makeObject(e){const t=this,n={element:e,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1,set(){}},parent:null};let s=!0;Object.defineProperty(n,"visible",{get(){return s},set(a){s=a,e.style.display=a?"":"none"}});const r={_x:0,_y:0,_z:0},o=()=>t.applyTransform(e,r._x,r._y,r._z,n.rotation.x,n.rotation.y);return Object.defineProperties(r,{x:{get(){return this._x},set(a){this._x=a,o()},enumerable:!0},y:{get(){return this._y},set(a){this._y=a,o()},enumerable:!0},z:{get(){return this._z},set(a){this._z=a,o()},enumerable:!0}}),r.set=function(a,l,c){this._x=a,this._y=l,this._z=c,o()},n.position=r,n}}const zo=navigator.userAgent||"",Li=/Mobi|Android|iPhone|iPad|iPod/i.test(zo)&&!/OBS/i.test(zo),Tt=/OBS/i.test(zo)||new URLSearchParams(window.location.search).has("transparent"),ng=33,ig=33;class sg{constructor(e){this.config=e,this.scene=new ru,this._updateCallbacks=[],this._running=!1,this._frameCount=0,this._lastTime=0,this._rafId=null,this._timeoutId=null,this._hidden=document.hidden,this.cameraController=new Qm(e.baseWidth),this.camera=this.cameraController.camera,this.webglRenderer=new Jm({alpha:!0,antialias:!1,premultipliedAlpha:!1,powerPreference:Li?"low-power":"default"}),this.webglRenderer.setClearColor(0,0),this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio,Li?1.5:2)),this.webglRenderer.setSize(window.innerWidth,window.innerHeight),this.webglRenderer.domElement.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;",this.webglRenderer.domElement.id="webgl-canvas",document.body.appendChild(this.webglRenderer.domElement),this.domRenderer=new tg(e.baseWidth),document.body.appendChild(this.domRenderer.domElement);const t=new fu(3359829,.6);this.scene.add(t);const n=new Ya(2282478,1.5,3600);n.position.set(e.baseWidth/2,-900,1350),this.scene.add(n);const s=new Ya(16498468,.8,2700);s.position.set(e.baseWidth*.8,-450,900),this.scene.add(s),this._applyViewportScale(),window.addEventListener("resize",()=>this._onResize()),document.addEventListener("visibilitychange",()=>this._onVisibilityChange())}_applyViewportScale(){const e=window.innerWidth,t=window.innerHeight;let n=e/this.config.baseWidth,s=Math.round(t/n);const r=this.config.baseWidth;let o=this.config.baseWidth;s<r&&(s=r,n=t/s,o=Math.round(e/n)),!Li&&!Tt&&n>.25&&(n=.25,s=Math.round(t/n),o=Math.round(e/n)),this.cameraController.resize(o,s,this.config.baseWidth),this.webglRenderer.setSize(e,t),this.domRenderer.resize({scale:n,width:this.config.baseWidth,height:s}),this.viewport={width:this.config.baseWidth,height:s,scale:n},document.documentElement.style.setProperty("--base-width",this.config.baseWidth+"px"),document.documentElement.style.setProperty("--base-height",s+"px")}_onResize(){this._applyViewportScale()}onUpdate(e){this._updateCallbacks.push(e)}start(){this._running||(this._running=!0,this._lastTime=performance.now(),this._hidden=document.hidden,this._scheduleNext())}stop(){this._running=!1,this._rafId!==null&&(cancelAnimationFrame(this._rafId),this._rafId=null),this._timeoutId!==null&&(clearTimeout(this._timeoutId),this._timeoutId=null)}_onVisibilityChange(){if(!this._running)return;const e=document.hidden;e!==this._hidden&&(this._hidden=e,this._lastTime=performance.now(),this._rafId!==null&&(cancelAnimationFrame(this._rafId),this._rafId=null),this._timeoutId!==null&&(clearTimeout(this._timeoutId),this._timeoutId=null),this._scheduleNext())}_scheduleNext(){if(this._running)if(this._hidden||Tt){const e=this._hidden?ng:ig;this._timeoutId=setTimeout(()=>{this._timeoutId=null,this._tick(),this._scheduleNext()},e)}else this._rafId=requestAnimationFrame(()=>{this._rafId=null,this._tick(),this._scheduleNext()})}_tick(){const e=performance.now(),t=(e-this._lastTime)/1e3;this._lastTime=e;const n=Math.min(t,.05);for(const s of this._updateCallbacks)s(n);this._frameCount++,(!Li&&!Tt||(this._frameCount&1)===0)&&this.webglRenderer.render(this.scene,this.camera)}}const yl={easeBackOut(i){return--i*i*((1.70158+1)*i+1.70158)+1},easeCubicInOut(i){return i<.5?4*i*i*i:1-Math.pow(-2*i+2,3)/2},easeQuadIn(i){return i*i},easeLinear(i){return i},easeOutCubic(i){return 1-Math.pow(1-i,3)}};class rg{constructor(){this.tweens=[]}tween(e){const t=typeof e.easing=="function"?e.easing:yl[e.easing]||yl.easeLinear;this.tweens.push({target:e.target,prop:e.prop,from:e.from,to:e.to,duration:e.duration,easing:t,apply:e.apply||null,onComplete:e.onComplete||null,startTime:performance.now()})}cancelFor(e){this.tweens=this.tweens.filter(t=>t.target!==e)}update(){const e=performance.now();for(let t=this.tweens.length-1;t>=0;t--){const n=this.tweens[t],s=e-n.startTime,r=Math.min(s/n.duration,1),o=n.easing(r),a=n.from+(n.to-n.from)*o;n.apply?n.apply(a):n.target&&n.prop&&(n.target[n.prop]=a),r>=1&&(n.onComplete&&n.onComplete(),this.tweens.splice(t,1))}}get active(){return this.tweens.length>0}}const ln=Object.create(null);ln.open="0";ln.close="1";ln.ping="2";ln.pong="3";ln.message="4";ln.upgrade="5";ln.noop="6";const js=Object.create(null);Object.keys(ln).forEach(i=>{js[ln[i]]=i});const Ho={type:"error",data:"parser error"},Ec=typeof Blob=="function"||typeof Blob<"u"&&Object.prototype.toString.call(Blob)==="[object BlobConstructor]",Mc=typeof ArrayBuffer=="function",bc=i=>typeof ArrayBuffer.isView=="function"?ArrayBuffer.isView(i):i&&i.buffer instanceof ArrayBuffer,oa=({type:i,data:e},t,n)=>Ec&&e instanceof Blob?t?n(e):xl(e,n):Mc&&(e instanceof ArrayBuffer||bc(e))?t?n(e):xl(new Blob([e]),n):n(ln[i]+(e||"")),xl=(i,e)=>{const t=new FileReader;return t.onload=function(){const n=t.result.split(",")[1];e("b"+(n||""))},t.readAsDataURL(i)};function Sl(i){return i instanceof Uint8Array?i:i instanceof ArrayBuffer?new Uint8Array(i):new Uint8Array(i.buffer,i.byteOffset,i.byteLength)}let Wr;function og(i,e){if(Ec&&i.data instanceof Blob)return i.data.arrayBuffer().then(Sl).then(e);if(Mc&&(i.data instanceof ArrayBuffer||bc(i.data)))return e(Sl(i.data));oa(i,!1,t=>{Wr||(Wr=new TextEncoder),e(Wr.encode(t))})}const El="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",os=typeof Uint8Array>"u"?[]:new Uint8Array(256);for(let i=0;i<El.length;i++)os[El.charCodeAt(i)]=i;const ag=i=>{let e=i.length*.75,t=i.length,n,s=0,r,o,a,l;i[i.length-1]==="="&&(e--,i[i.length-2]==="="&&e--);const c=new ArrayBuffer(e),d=new Uint8Array(c);for(n=0;n<t;n+=4)r=os[i.charCodeAt(n)],o=os[i.charCodeAt(n+1)],a=os[i.charCodeAt(n+2)],l=os[i.charCodeAt(n+3)],d[s++]=r<<2|o>>4,d[s++]=(o&15)<<4|a>>2,d[s++]=(a&3)<<6|l&63;return c},lg=typeof ArrayBuffer=="function",aa=(i,e)=>{if(typeof i!="string")return{type:"message",data:wc(i,e)};const t=i.charAt(0);return t==="b"?{type:"message",data:cg(i.substring(1),e)}:js[t]?i.length>1?{type:js[t],data:i.substring(1)}:{type:js[t]}:Ho},cg=(i,e)=>{if(lg){const t=ag(i);return wc(t,e)}else return{base64:!0,data:i}},wc=(i,e)=>{switch(e){case"blob":return i instanceof Blob?i:new Blob([i]);case"arraybuffer":default:return i instanceof ArrayBuffer?i:i.buffer}},Tc="",hg=(i,e)=>{const t=i.length,n=new Array(t);let s=0;i.forEach((r,o)=>{oa(r,!1,a=>{n[o]=a,++s===t&&e(n.join(Tc))})})},ug=(i,e)=>{const t=i.split(Tc),n=[];for(let s=0;s<t.length;s++){const r=aa(t[s],e);if(n.push(r),r.type==="error")break}return n};function dg(){return new TransformStream({transform(i,e){og(i,t=>{const n=t.length;let s;if(n<126)s=new Uint8Array(1),new DataView(s.buffer).setUint8(0,n);else if(n<65536){s=new Uint8Array(3);const r=new DataView(s.buffer);r.setUint8(0,126),r.setUint16(1,n)}else{s=new Uint8Array(9);const r=new DataView(s.buffer);r.setUint8(0,127),r.setBigUint64(1,BigInt(n))}i.data&&typeof i.data!="string"&&(s[0]|=128),e.enqueue(s),e.enqueue(t)})}})}let Xr;function Hs(i){return i.reduce((e,t)=>e+t.length,0)}function Vs(i,e){if(i[0].length===e)return i.shift();const t=new Uint8Array(e);let n=0;for(let s=0;s<e;s++)t[s]=i[0][n++],n===i[0].length&&(i.shift(),n=0);return i.length&&n<i[0].length&&(i[0]=i[0].slice(n)),t}function fg(i,e){Xr||(Xr=new TextDecoder);const t=[];let n=0,s=-1,r=!1;return new TransformStream({transform(o,a){for(t.push(o);;){if(n===0){if(Hs(t)<1)break;const l=Vs(t,1);r=(l[0]&128)===128,s=l[0]&127,s<126?n=3:s===126?n=1:n=2}else if(n===1){if(Hs(t)<2)break;const l=Vs(t,2);s=new DataView(l.buffer,l.byteOffset,l.length).getUint16(0),n=3}else if(n===2){if(Hs(t)<8)break;const l=Vs(t,8),c=new DataView(l.buffer,l.byteOffset,l.length),d=c.getUint32(0);if(d>Math.pow(2,21)-1){a.enqueue(Ho);break}s=d*Math.pow(2,32)+c.getUint32(4),n=3}else{if(Hs(t)<s)break;const l=Vs(t,s);a.enqueue(aa(r?l:Xr.decode(l),e)),n=0}if(s===0||s>i){a.enqueue(Ho);break}}}})}const Ac=4;function pt(i){if(i)return pg(i)}function pg(i){for(var e in pt.prototype)i[e]=pt.prototype[e];return i}pt.prototype.on=pt.prototype.addEventListener=function(i,e){return this._callbacks=this._callbacks||{},(this._callbacks["$"+i]=this._callbacks["$"+i]||[]).push(e),this};pt.prototype.once=function(i,e){function t(){this.off(i,t),e.apply(this,arguments)}return t.fn=e,this.on(i,t),this};pt.prototype.off=pt.prototype.removeListener=pt.prototype.removeAllListeners=pt.prototype.removeEventListener=function(i,e){if(this._callbacks=this._callbacks||{},arguments.length==0)return this._callbacks={},this;var t=this._callbacks["$"+i];if(!t)return this;if(arguments.length==1)return delete this._callbacks["$"+i],this;for(var n,s=0;s<t.length;s++)if(n=t[s],n===e||n.fn===e){t.splice(s,1);break}return t.length===0&&delete this._callbacks["$"+i],this};pt.prototype.emit=function(i){this._callbacks=this._callbacks||{};for(var e=new Array(arguments.length-1),t=this._callbacks["$"+i],n=1;n<arguments.length;n++)e[n-1]=arguments[n];if(t){t=t.slice(0);for(var n=0,s=t.length;n<s;++n)t[n].apply(this,e)}return this};pt.prototype.emitReserved=pt.prototype.emit;pt.prototype.listeners=function(i){return this._callbacks=this._callbacks||{},this._callbacks["$"+i]||[]};pt.prototype.hasListeners=function(i){return!!this.listeners(i).length};const lr=typeof Promise=="function"&&typeof Promise.resolve=="function"?e=>Promise.resolve().then(e):(e,t)=>t(e,0),Yt=typeof self<"u"?self:typeof window<"u"?window:Function("return this")(),mg="arraybuffer";function Cc(i,...e){return e.reduce((t,n)=>(i.hasOwnProperty(n)&&(t[n]=i[n]),t),{})}const gg=Yt.setTimeout,_g=Yt.clearTimeout;function cr(i,e){e.useNativeTimers?(i.setTimeoutFn=gg.bind(Yt),i.clearTimeoutFn=_g.bind(Yt)):(i.setTimeoutFn=Yt.setTimeout.bind(Yt),i.clearTimeoutFn=Yt.clearTimeout.bind(Yt))}const vg=1.33;function yg(i){return typeof i=="string"?xg(i):Math.ceil((i.byteLength||i.size)*vg)}function xg(i){let e=0,t=0;for(let n=0,s=i.length;n<s;n++)e=i.charCodeAt(n),e<128?t+=1:e<2048?t+=2:e<55296||e>=57344?t+=3:(n++,t+=4);return t}function Rc(){return Date.now().toString(36).substring(3)+Math.random().toString(36).substring(2,5)}function Sg(i){let e="";for(let t in i)i.hasOwnProperty(t)&&(e.length&&(e+="&"),e+=encodeURIComponent(t)+"="+encodeURIComponent(i[t]));return e}function Eg(i){let e={},t=i.split("&");for(let n=0,s=t.length;n<s;n++){let r=t[n].split("=");e[decodeURIComponent(r[0])]=decodeURIComponent(r[1])}return e}class Mg extends Error{constructor(e,t,n){super(e),this.description=t,this.context=n,this.type="TransportError"}}class la extends pt{constructor(e){super(),this.writable=!1,cr(this,e),this.opts=e,this.query=e.query,this.socket=e.socket,this.supportsBinary=!e.forceBase64}onError(e,t,n){return super.emitReserved("error",new Mg(e,t,n)),this}open(){return this.readyState="opening",this.doOpen(),this}close(){return(this.readyState==="opening"||this.readyState==="open")&&(this.doClose(),this.onClose()),this}send(e){this.readyState==="open"&&this.write(e)}onOpen(){this.readyState="open",this.writable=!0,super.emitReserved("open")}onData(e){const t=aa(e,this.socket.binaryType);this.onPacket(t)}onPacket(e){super.emitReserved("packet",e)}onClose(e){this.readyState="closed",super.emitReserved("close",e)}pause(e){}createUri(e,t={}){return e+"://"+this._hostname()+this._port()+this.opts.path+this._query(t)}_hostname(){const e=this.opts.hostname;return e.indexOf(":")===-1?e:"["+e+"]"}_port(){return this.opts.port&&(this.opts.secure&&Number(this.opts.port)!==443||!this.opts.secure&&Number(this.opts.port)!==80)?":"+this.opts.port:""}_query(e){const t=Sg(e);return t.length?"?"+t:""}}class bg extends la{constructor(){super(...arguments),this._polling=!1}get name(){return"polling"}doOpen(){this._poll()}pause(e){this.readyState="pausing";const t=()=>{this.readyState="paused",e()};if(this._polling||!this.writable){let n=0;this._polling&&(n++,this.once("pollComplete",function(){--n||t()})),this.writable||(n++,this.once("drain",function(){--n||t()}))}else t()}_poll(){this._polling=!0,this.doPoll(),this.emitReserved("poll")}onData(e){const t=n=>{if(this.readyState==="opening"&&n.type==="open"&&this.onOpen(),n.type==="close")return this.onClose({description:"transport closed by the server"}),!1;this.onPacket(n)};ug(e,this.socket.binaryType).forEach(t),this.readyState!=="closed"&&(this._polling=!1,this.emitReserved("pollComplete"),this.readyState==="open"&&this._poll())}doClose(){const e=()=>{this.write([{type:"close"}])};this.readyState==="open"?e():this.once("open",e)}write(e){this.writable=!1,hg(e,t=>{this.doWrite(t,()=>{this.writable=!0,this.emitReserved("drain")})})}uri(){const e=this.opts.secure?"https":"http",t=this.query||{};return this.opts.timestampRequests!==!1&&(t[this.opts.timestampParam]=Rc()),!this.supportsBinary&&!t.sid&&(t.b64=1),this.createUri(e,t)}}let Pc=!1;try{Pc=typeof XMLHttpRequest<"u"&&"withCredentials"in new XMLHttpRequest}catch{}const wg=Pc;function Tg(){}class Ag extends bg{constructor(e){if(super(e),typeof location<"u"){const t=location.protocol==="https:";let n=location.port;n||(n=t?"443":"80"),this.xd=typeof location<"u"&&e.hostname!==location.hostname||n!==e.port}}doWrite(e,t){const n=this.request({method:"POST",data:e});n.on("success",t),n.on("error",(s,r)=>{this.onError("xhr post error",s,r)})}doPoll(){const e=this.request();e.on("data",this.onData.bind(this)),e.on("error",(t,n)=>{this.onError("xhr poll error",t,n)}),this.pollXhr=e}}class an extends pt{constructor(e,t,n){super(),this.createRequest=e,cr(this,n),this._opts=n,this._method=n.method||"GET",this._uri=t,this._data=n.data!==void 0?n.data:null,this._create()}_create(){var e;const t=Cc(this._opts,"agent","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","autoUnref");t.xdomain=!!this._opts.xd;const n=this._xhr=this.createRequest(t);try{n.open(this._method,this._uri,!0);try{if(this._opts.extraHeaders){n.setDisableHeaderCheck&&n.setDisableHeaderCheck(!0);for(let s in this._opts.extraHeaders)this._opts.extraHeaders.hasOwnProperty(s)&&n.setRequestHeader(s,this._opts.extraHeaders[s])}}catch{}if(this._method==="POST")try{n.setRequestHeader("Content-type","text/plain;charset=UTF-8")}catch{}try{n.setRequestHeader("Accept","*/*")}catch{}(e=this._opts.cookieJar)===null||e===void 0||e.addCookies(n),"withCredentials"in n&&(n.withCredentials=this._opts.withCredentials),this._opts.requestTimeout&&(n.timeout=this._opts.requestTimeout),n.onreadystatechange=()=>{var s;n.readyState===3&&((s=this._opts.cookieJar)===null||s===void 0||s.parseCookies(n.getResponseHeader("set-cookie"))),n.readyState===4&&(n.status===200||n.status===1223?this._onLoad():this.setTimeoutFn(()=>{this._onError(typeof n.status=="number"?n.status:0)},0))},n.send(this._data)}catch(s){this.setTimeoutFn(()=>{this._onError(s)},0);return}typeof document<"u"&&(this._index=an.requestsCount++,an.requests[this._index]=this)}_onError(e){this.emitReserved("error",e,this._xhr),this._cleanup(!0)}_cleanup(e){if(!(typeof this._xhr>"u"||this._xhr===null)){if(this._xhr.onreadystatechange=Tg,e)try{this._xhr.abort()}catch{}typeof document<"u"&&delete an.requests[this._index],this._xhr=null}}_onLoad(){const e=this._xhr.responseText;e!==null&&(this.emitReserved("data",e),this.emitReserved("success"),this._cleanup())}abort(){this._cleanup()}}an.requestsCount=0;an.requests={};if(typeof document<"u"){if(typeof attachEvent=="function")attachEvent("onunload",Ml);else if(typeof addEventListener=="function"){const i="onpagehide"in Yt?"pagehide":"unload";addEventListener(i,Ml,!1)}}function Ml(){for(let i in an.requests)an.requests.hasOwnProperty(i)&&an.requests[i].abort()}const Cg=(function(){const i=Lc({xdomain:!1});return i&&i.responseType!==null})();class Rg extends Ag{constructor(e){super(e);const t=e&&e.forceBase64;this.supportsBinary=Cg&&!t}request(e={}){return Object.assign(e,{xd:this.xd},this.opts),new an(Lc,this.uri(),e)}}function Lc(i){const e=i.xdomain;try{if(typeof XMLHttpRequest<"u"&&(!e||wg))return new XMLHttpRequest}catch{}if(!e)try{return new Yt[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP")}catch{}}const Dc=typeof navigator<"u"&&typeof navigator.product=="string"&&navigator.product.toLowerCase()==="reactnative";class Pg extends la{get name(){return"websocket"}doOpen(){const e=this.uri(),t=this.opts.protocols,n=Dc?{}:Cc(this.opts,"agent","perMessageDeflate","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","localAddress","protocolVersion","origin","maxPayload","family","checkServerIdentity");this.opts.extraHeaders&&(n.headers=this.opts.extraHeaders);try{this.ws=this.createSocket(e,t,n)}catch(s){return this.emitReserved("error",s)}this.ws.binaryType=this.socket.binaryType,this.addEventListeners()}addEventListeners(){this.ws.onopen=()=>{this.opts.autoUnref&&this.ws._socket.unref(),this.onOpen()},this.ws.onclose=e=>this.onClose({description:"websocket connection closed",context:e}),this.ws.onmessage=e=>this.onData(e.data),this.ws.onerror=e=>this.onError("websocket error",e)}write(e){this.writable=!1;for(let t=0;t<e.length;t++){const n=e[t],s=t===e.length-1;oa(n,this.supportsBinary,r=>{try{this.doWrite(n,r)}catch{}s&&lr(()=>{this.writable=!0,this.emitReserved("drain")},this.setTimeoutFn)})}}doClose(){typeof this.ws<"u"&&(this.ws.onerror=()=>{},this.ws.close(),this.ws=null)}uri(){const e=this.opts.secure?"wss":"ws",t=this.query||{};return this.opts.timestampRequests&&(t[this.opts.timestampParam]=Rc()),this.supportsBinary||(t.b64=1),this.createUri(e,t)}}const qr=Yt.WebSocket||Yt.MozWebSocket;class Lg extends Pg{createSocket(e,t,n){return Dc?new qr(e,t,n):t?new qr(e,t):new qr(e)}doWrite(e,t){this.ws.send(t)}}class Dg extends la{get name(){return"webtransport"}doOpen(){try{this._transport=new WebTransport(this.createUri("https"),this.opts.transportOptions[this.name])}catch(e){return this.emitReserved("error",e)}this._transport.closed.then(()=>{this.onClose()}).catch(e=>{this.onError("webtransport error",e)}),this._transport.ready.then(()=>{this._transport.createBidirectionalStream().then(e=>{const t=fg(Number.MAX_SAFE_INTEGER,this.socket.binaryType),n=e.readable.pipeThrough(t).getReader(),s=dg();s.readable.pipeTo(e.writable),this._writer=s.writable.getWriter();const r=()=>{n.read().then(({done:a,value:l})=>{a||(this.onPacket(l),r())}).catch(a=>{})};r();const o={type:"open"};this.query.sid&&(o.data=`{"sid":"${this.query.sid}"}`),this._writer.write(o).then(()=>this.onOpen())})})}write(e){this.writable=!1;for(let t=0;t<e.length;t++){const n=e[t],s=t===e.length-1;this._writer.write(n).then(()=>{s&&lr(()=>{this.writable=!0,this.emitReserved("drain")},this.setTimeoutFn)})}}doClose(){var e;(e=this._transport)===null||e===void 0||e.close()}}const Ig={websocket:Lg,webtransport:Dg,polling:Rg},Ug=/^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/,Ng=["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"];function Vo(i){if(i.length>8e3)throw"URI too long";const e=i,t=i.indexOf("["),n=i.indexOf("]");t!=-1&&n!=-1&&(i=i.substring(0,t)+i.substring(t,n).replace(/:/g,";")+i.substring(n,i.length));let s=Ug.exec(i||""),r={},o=14;for(;o--;)r[Ng[o]]=s[o]||"";return t!=-1&&n!=-1&&(r.source=e,r.host=r.host.substring(1,r.host.length-1).replace(/;/g,":"),r.authority=r.authority.replace("[","").replace("]","").replace(/;/g,":"),r.ipv6uri=!0),r.pathNames=Fg(r,r.path),r.queryKey=Og(r,r.query),r}function Fg(i,e){const t=/\/{2,9}/g,n=e.replace(t,"/").split("/");return(e.slice(0,1)=="/"||e.length===0)&&n.splice(0,1),e.slice(-1)=="/"&&n.splice(n.length-1,1),n}function Og(i,e){const t={};return e.replace(/(?:^|&)([^&=]*)=?([^&]*)/g,function(n,s,r){s&&(t[s]=r)}),t}const Go=typeof addEventListener=="function"&&typeof removeEventListener=="function",Ks=[];Go&&addEventListener("offline",()=>{Ks.forEach(i=>i())},!1);class On extends pt{constructor(e,t){if(super(),this.binaryType=mg,this.writeBuffer=[],this._prevBufferLen=0,this._pingInterval=-1,this._pingTimeout=-1,this._maxPayload=-1,this._pingTimeoutTime=1/0,e&&typeof e=="object"&&(t=e,e=null),e){const n=Vo(e);t.hostname=n.host,t.secure=n.protocol==="https"||n.protocol==="wss",t.port=n.port,n.query&&(t.query=n.query)}else t.host&&(t.hostname=Vo(t.host).host);cr(this,t),this.secure=t.secure!=null?t.secure:typeof location<"u"&&location.protocol==="https:",t.hostname&&!t.port&&(t.port=this.secure?"443":"80"),this.hostname=t.hostname||(typeof location<"u"?location.hostname:"localhost"),this.port=t.port||(typeof location<"u"&&location.port?location.port:this.secure?"443":"80"),this.transports=[],this._transportsByName={},t.transports.forEach(n=>{const s=n.prototype.name;this.transports.push(s),this._transportsByName[s]=n}),this.opts=Object.assign({path:"/engine.io",agent:!1,withCredentials:!1,upgrade:!0,timestampParam:"t",rememberUpgrade:!1,addTrailingSlash:!0,rejectUnauthorized:!0,perMessageDeflate:{threshold:1024},transportOptions:{},closeOnBeforeunload:!1},t),this.opts.path=this.opts.path.replace(/\/$/,"")+(this.opts.addTrailingSlash?"/":""),typeof this.opts.query=="string"&&(this.opts.query=Eg(this.opts.query)),Go&&(this.opts.closeOnBeforeunload&&(this._beforeunloadEventListener=()=>{this.transport&&(this.transport.removeAllListeners(),this.transport.close())},addEventListener("beforeunload",this._beforeunloadEventListener,!1)),this.hostname!=="localhost"&&(this._offlineEventListener=()=>{this._onClose("transport close",{description:"network connection lost"})},Ks.push(this._offlineEventListener))),this.opts.withCredentials&&(this._cookieJar=void 0),this._open()}createTransport(e){const t=Object.assign({},this.opts.query);t.EIO=Ac,t.transport=e,this.id&&(t.sid=this.id);const n=Object.assign({},this.opts,{query:t,socket:this,hostname:this.hostname,secure:this.secure,port:this.port},this.opts.transportOptions[e]);return new this._transportsByName[e](n)}_open(){if(this.transports.length===0){this.setTimeoutFn(()=>{this.emitReserved("error","No transports available")},0);return}const e=this.opts.rememberUpgrade&&On.priorWebsocketSuccess&&this.transports.indexOf("websocket")!==-1?"websocket":this.transports[0];this.readyState="opening";const t=this.createTransport(e);t.open(),this.setTransport(t)}setTransport(e){this.transport&&this.transport.removeAllListeners(),this.transport=e,e.on("drain",this._onDrain.bind(this)).on("packet",this._onPacket.bind(this)).on("error",this._onError.bind(this)).on("close",t=>this._onClose("transport close",t))}onOpen(){this.readyState="open",On.priorWebsocketSuccess=this.transport.name==="websocket",this.emitReserved("open"),this.flush()}_onPacket(e){if(this.readyState==="opening"||this.readyState==="open"||this.readyState==="closing")switch(this.emitReserved("packet",e),this.emitReserved("heartbeat"),e.type){case"open":this.onHandshake(JSON.parse(e.data));break;case"ping":this._sendPacket("pong"),this.emitReserved("ping"),this.emitReserved("pong"),this._resetPingTimeout();break;case"error":const t=new Error("server error");t.code=e.data,this._onError(t);break;case"message":this.emitReserved("data",e.data),this.emitReserved("message",e.data);break}}onHandshake(e){this.emitReserved("handshake",e),this.id=e.sid,this.transport.query.sid=e.sid,this._pingInterval=e.pingInterval,this._pingTimeout=e.pingTimeout,this._maxPayload=e.maxPayload,this.onOpen(),this.readyState!=="closed"&&this._resetPingTimeout()}_resetPingTimeout(){this.clearTimeoutFn(this._pingTimeoutTimer);const e=this._pingInterval+this._pingTimeout;this._pingTimeoutTime=Date.now()+e,this._pingTimeoutTimer=this.setTimeoutFn(()=>{this._onClose("ping timeout")},e),this.opts.autoUnref&&this._pingTimeoutTimer.unref()}_onDrain(){this.writeBuffer.splice(0,this._prevBufferLen),this._prevBufferLen=0,this.writeBuffer.length===0?this.emitReserved("drain"):this.flush()}flush(){if(this.readyState!=="closed"&&this.transport.writable&&!this.upgrading&&this.writeBuffer.length){const e=this._getWritablePackets();this.transport.send(e),this._prevBufferLen=e.length,this.emitReserved("flush")}}_getWritablePackets(){if(!(this._maxPayload&&this.transport.name==="polling"&&this.writeBuffer.length>1))return this.writeBuffer;let t=1;for(let n=0;n<this.writeBuffer.length;n++){const s=this.writeBuffer[n].data;if(s&&(t+=yg(s)),n>0&&t>this._maxPayload)return this.writeBuffer.slice(0,n);t+=2}return this.writeBuffer}_hasPingExpired(){if(!this._pingTimeoutTime)return!0;const e=Date.now()>this._pingTimeoutTime;return e&&(this._pingTimeoutTime=0,lr(()=>{this._onClose("ping timeout")},this.setTimeoutFn)),e}write(e,t,n){return this._sendPacket("message",e,t,n),this}send(e,t,n){return this._sendPacket("message",e,t,n),this}_sendPacket(e,t,n,s){if(typeof t=="function"&&(s=t,t=void 0),typeof n=="function"&&(s=n,n=null),this.readyState==="closing"||this.readyState==="closed")return;n=n||{},n.compress=n.compress!==!1;const r={type:e,data:t,options:n};this.emitReserved("packetCreate",r),this.writeBuffer.push(r),s&&this.once("flush",s),this.flush()}close(){const e=()=>{this._onClose("forced close"),this.transport.close()},t=()=>{this.off("upgrade",t),this.off("upgradeError",t),e()},n=()=>{this.once("upgrade",t),this.once("upgradeError",t)};return(this.readyState==="opening"||this.readyState==="open")&&(this.readyState="closing",this.writeBuffer.length?this.once("drain",()=>{this.upgrading?n():e()}):this.upgrading?n():e()),this}_onError(e){if(On.priorWebsocketSuccess=!1,this.opts.tryAllTransports&&this.transports.length>1&&this.readyState==="opening")return this.transports.shift(),this._open();this.emitReserved("error",e),this._onClose("transport error",e)}_onClose(e,t){if(this.readyState==="opening"||this.readyState==="open"||this.readyState==="closing"){if(this.clearTimeoutFn(this._pingTimeoutTimer),this.transport.removeAllListeners("close"),this.transport.close(),this.transport.removeAllListeners(),Go&&(this._beforeunloadEventListener&&removeEventListener("beforeunload",this._beforeunloadEventListener,!1),this._offlineEventListener)){const n=Ks.indexOf(this._offlineEventListener);n!==-1&&Ks.splice(n,1)}this.readyState="closed",this.id=null,this.emitReserved("close",e,t),this.writeBuffer=[],this._prevBufferLen=0}}}On.protocol=Ac;class Bg extends On{constructor(){super(...arguments),this._upgrades=[]}onOpen(){if(super.onOpen(),this.readyState==="open"&&this.opts.upgrade)for(let e=0;e<this._upgrades.length;e++)this._probe(this._upgrades[e])}_probe(e){let t=this.createTransport(e),n=!1;On.priorWebsocketSuccess=!1;const s=()=>{n||(t.send([{type:"ping",data:"probe"}]),t.once("packet",f=>{if(!n)if(f.type==="pong"&&f.data==="probe"){if(this.upgrading=!0,this.emitReserved("upgrading",t),!t)return;On.priorWebsocketSuccess=t.name==="websocket",this.transport.pause(()=>{n||this.readyState!=="closed"&&(d(),this.setTransport(t),t.send([{type:"upgrade"}]),this.emitReserved("upgrade",t),t=null,this.upgrading=!1,this.flush())})}else{const u=new Error("probe error");u.transport=t.name,this.emitReserved("upgradeError",u)}}))};function r(){n||(n=!0,d(),t.close(),t=null)}const o=f=>{const u=new Error("probe error: "+f);u.transport=t.name,r(),this.emitReserved("upgradeError",u)};function a(){o("transport closed")}function l(){o("socket closed")}function c(f){t&&f.name!==t.name&&r()}const d=()=>{t.removeListener("open",s),t.removeListener("error",o),t.removeListener("close",a),this.off("close",l),this.off("upgrading",c)};t.once("open",s),t.once("error",o),t.once("close",a),this.once("close",l),this.once("upgrading",c),this._upgrades.indexOf("webtransport")!==-1&&e!=="webtransport"?this.setTimeoutFn(()=>{n||t.open()},200):t.open()}onHandshake(e){this._upgrades=this._filterUpgrades(e.upgrades),super.onHandshake(e)}_filterUpgrades(e){const t=[];for(let n=0;n<e.length;n++)~this.transports.indexOf(e[n])&&t.push(e[n]);return t}}let kg=class extends Bg{constructor(e,t={}){const n=typeof e=="object"?e:t;(!n.transports||n.transports&&typeof n.transports[0]=="string")&&(n.transports=(n.transports||["polling","websocket","webtransport"]).map(s=>Ig[s]).filter(s=>!!s)),super(e,n)}};function zg(i,e="",t){let n=i;t=t||typeof location<"u"&&location,i==null&&(i=t.protocol+"//"+t.host),typeof i=="string"&&(i.charAt(0)==="/"&&(i.charAt(1)==="/"?i=t.protocol+i:i=t.host+i),/^(https?|wss?):\/\//.test(i)||(typeof t<"u"?i=t.protocol+"//"+i:i="https://"+i),n=Vo(i)),n.port||(/^(http|ws)$/.test(n.protocol)?n.port="80":/^(http|ws)s$/.test(n.protocol)&&(n.port="443")),n.path=n.path||"/";const r=n.host.indexOf(":")!==-1?"["+n.host+"]":n.host;return n.id=n.protocol+"://"+r+":"+n.port+e,n.href=n.protocol+"://"+r+(t&&t.port===n.port?"":":"+n.port),n}const Hg=typeof ArrayBuffer=="function",Vg=i=>typeof ArrayBuffer.isView=="function"?ArrayBuffer.isView(i):i.buffer instanceof ArrayBuffer,Ic=Object.prototype.toString,Gg=typeof Blob=="function"||typeof Blob<"u"&&Ic.call(Blob)==="[object BlobConstructor]",Wg=typeof File=="function"||typeof File<"u"&&Ic.call(File)==="[object FileConstructor]";function ca(i){return Hg&&(i instanceof ArrayBuffer||Vg(i))||Gg&&i instanceof Blob||Wg&&i instanceof File}function Zs(i,e){if(!i||typeof i!="object")return!1;if(Array.isArray(i)){for(let t=0,n=i.length;t<n;t++)if(Zs(i[t]))return!0;return!1}if(ca(i))return!0;if(i.toJSON&&typeof i.toJSON=="function"&&arguments.length===1)return Zs(i.toJSON(),!0);for(const t in i)if(Object.prototype.hasOwnProperty.call(i,t)&&Zs(i[t]))return!0;return!1}function Xg(i){const e=[],t=i.data,n=i;return n.data=Wo(t,e),n.attachments=e.length,{packet:n,buffers:e}}function Wo(i,e){if(!i)return i;if(ca(i)){const t={_placeholder:!0,num:e.length};return e.push(i),t}else if(Array.isArray(i)){const t=new Array(i.length);for(let n=0;n<i.length;n++)t[n]=Wo(i[n],e);return t}else if(typeof i=="object"&&!(i instanceof Date)){const t={};for(const n in i)Object.prototype.hasOwnProperty.call(i,n)&&(t[n]=Wo(i[n],e));return t}return i}function qg(i,e){return i.data=Xo(i.data,e),delete i.attachments,i}function Xo(i,e){if(!i)return i;if(i&&i._placeholder===!0){if(typeof i.num=="number"&&i.num>=0&&i.num<e.length)return e[i.num];throw new Error("illegal attachments")}else if(Array.isArray(i))for(let t=0;t<i.length;t++)i[t]=Xo(i[t],e);else if(typeof i=="object")for(const t in i)Object.prototype.hasOwnProperty.call(i,t)&&(i[t]=Xo(i[t],e));return i}const Yg=["connect","connect_error","disconnect","disconnecting","newListener","removeListener"];var Ne;(function(i){i[i.CONNECT=0]="CONNECT",i[i.DISCONNECT=1]="DISCONNECT",i[i.EVENT=2]="EVENT",i[i.ACK=3]="ACK",i[i.CONNECT_ERROR=4]="CONNECT_ERROR",i[i.BINARY_EVENT=5]="BINARY_EVENT",i[i.BINARY_ACK=6]="BINARY_ACK"})(Ne||(Ne={}));class $g{constructor(e){this.replacer=e}encode(e){return(e.type===Ne.EVENT||e.type===Ne.ACK)&&Zs(e)?this.encodeAsBinary({type:e.type===Ne.EVENT?Ne.BINARY_EVENT:Ne.BINARY_ACK,nsp:e.nsp,data:e.data,id:e.id}):[this.encodeAsString(e)]}encodeAsString(e){let t=""+e.type;return(e.type===Ne.BINARY_EVENT||e.type===Ne.BINARY_ACK)&&(t+=e.attachments+"-"),e.nsp&&e.nsp!=="/"&&(t+=e.nsp+","),e.id!=null&&(t+=e.id),e.data!=null&&(t+=JSON.stringify(e.data,this.replacer)),t}encodeAsBinary(e){const t=Xg(e),n=this.encodeAsString(t.packet),s=t.buffers;return s.unshift(n),s}}class ha extends pt{constructor(e){super(),this.reviver=e}add(e){let t;if(typeof e=="string"){if(this.reconstructor)throw new Error("got plaintext data when reconstructing a packet");t=this.decodeString(e);const n=t.type===Ne.BINARY_EVENT;n||t.type===Ne.BINARY_ACK?(t.type=n?Ne.EVENT:Ne.ACK,this.reconstructor=new jg(t),t.attachments===0&&super.emitReserved("decoded",t)):super.emitReserved("decoded",t)}else if(ca(e)||e.base64)if(this.reconstructor)t=this.reconstructor.takeBinaryData(e),t&&(this.reconstructor=null,super.emitReserved("decoded",t));else throw new Error("got binary data when not reconstructing a packet");else throw new Error("Unknown type: "+e)}decodeString(e){let t=0;const n={type:Number(e.charAt(0))};if(Ne[n.type]===void 0)throw new Error("unknown packet type "+n.type);if(n.type===Ne.BINARY_EVENT||n.type===Ne.BINARY_ACK){const r=t+1;for(;e.charAt(++t)!=="-"&&t!=e.length;);const o=e.substring(r,t);if(o!=Number(o)||e.charAt(t)!=="-")throw new Error("Illegal attachments");n.attachments=Number(o)}if(e.charAt(t+1)==="/"){const r=t+1;for(;++t&&!(e.charAt(t)===","||t===e.length););n.nsp=e.substring(r,t)}else n.nsp="/";const s=e.charAt(t+1);if(s!==""&&Number(s)==s){const r=t+1;for(;++t;){const o=e.charAt(t);if(o==null||Number(o)!=o){--t;break}if(t===e.length)break}n.id=Number(e.substring(r,t+1))}if(e.charAt(++t)){const r=this.tryParse(e.substr(t));if(ha.isPayloadValid(n.type,r))n.data=r;else throw new Error("invalid payload")}return n}tryParse(e){try{return JSON.parse(e,this.reviver)}catch{return!1}}static isPayloadValid(e,t){switch(e){case Ne.CONNECT:return bl(t);case Ne.DISCONNECT:return t===void 0;case Ne.CONNECT_ERROR:return typeof t=="string"||bl(t);case Ne.EVENT:case Ne.BINARY_EVENT:return Array.isArray(t)&&(typeof t[0]=="number"||typeof t[0]=="string"&&Yg.indexOf(t[0])===-1);case Ne.ACK:case Ne.BINARY_ACK:return Array.isArray(t)}}destroy(){this.reconstructor&&(this.reconstructor.finishedReconstruction(),this.reconstructor=null)}}class jg{constructor(e){this.packet=e,this.buffers=[],this.reconPack=e}takeBinaryData(e){if(this.buffers.push(e),this.buffers.length===this.reconPack.attachments){const t=qg(this.reconPack,this.buffers);return this.finishedReconstruction(),t}return null}finishedReconstruction(){this.reconPack=null,this.buffers=[]}}function bl(i){return Object.prototype.toString.call(i)==="[object Object]"}const Kg=Object.freeze(Object.defineProperty({__proto__:null,Decoder:ha,Encoder:$g,get PacketType(){return Ne}},Symbol.toStringTag,{value:"Module"}));function Qt(i,e,t){return i.on(e,t),function(){i.off(e,t)}}const Zg=Object.freeze({connect:1,connect_error:1,disconnect:1,disconnecting:1,newListener:1,removeListener:1});class Uc extends pt{constructor(e,t,n){super(),this.connected=!1,this.recovered=!1,this.receiveBuffer=[],this.sendBuffer=[],this._queue=[],this._queueSeq=0,this.ids=0,this.acks={},this.flags={},this.io=e,this.nsp=t,n&&n.auth&&(this.auth=n.auth),this._opts=Object.assign({},n),this.io._autoConnect&&this.open()}get disconnected(){return!this.connected}subEvents(){if(this.subs)return;const e=this.io;this.subs=[Qt(e,"open",this.onopen.bind(this)),Qt(e,"packet",this.onpacket.bind(this)),Qt(e,"error",this.onerror.bind(this)),Qt(e,"close",this.onclose.bind(this))]}get active(){return!!this.subs}connect(){return this.connected?this:(this.subEvents(),this.io._reconnecting||this.io.open(),this.io._readyState==="open"&&this.onopen(),this)}open(){return this.connect()}send(...e){return e.unshift("message"),this.emit.apply(this,e),this}emit(e,...t){var n,s,r;if(Zg.hasOwnProperty(e))throw new Error('"'+e.toString()+'" is a reserved event name');if(t.unshift(e),this._opts.retries&&!this.flags.fromQueue&&!this.flags.volatile)return this._addToQueue(t),this;const o={type:Ne.EVENT,data:t};if(o.options={},o.options.compress=this.flags.compress!==!1,typeof t[t.length-1]=="function"){const d=this.ids++,f=t.pop();this._registerAckCallback(d,f),o.id=d}const a=(s=(n=this.io.engine)===null||n===void 0?void 0:n.transport)===null||s===void 0?void 0:s.writable,l=this.connected&&!(!((r=this.io.engine)===null||r===void 0)&&r._hasPingExpired());return this.flags.volatile&&!a||(l?(this.notifyOutgoingListeners(o),this.packet(o)):this.sendBuffer.push(o)),this.flags={},this}_registerAckCallback(e,t){var n;const s=(n=this.flags.timeout)!==null&&n!==void 0?n:this._opts.ackTimeout;if(s===void 0){this.acks[e]=t;return}const r=this.io.setTimeoutFn(()=>{delete this.acks[e];for(let a=0;a<this.sendBuffer.length;a++)this.sendBuffer[a].id===e&&this.sendBuffer.splice(a,1);t.call(this,new Error("operation has timed out"))},s),o=(...a)=>{this.io.clearTimeoutFn(r),t.apply(this,a)};o.withError=!0,this.acks[e]=o}emitWithAck(e,...t){return new Promise((n,s)=>{const r=(o,a)=>o?s(o):n(a);r.withError=!0,t.push(r),this.emit(e,...t)})}_addToQueue(e){let t;typeof e[e.length-1]=="function"&&(t=e.pop());const n={id:this._queueSeq++,tryCount:0,pending:!1,args:e,flags:Object.assign({fromQueue:!0},this.flags)};e.push((s,...r)=>(this._queue[0],s!==null?n.tryCount>this._opts.retries&&(this._queue.shift(),t&&t(s)):(this._queue.shift(),t&&t(null,...r)),n.pending=!1,this._drainQueue())),this._queue.push(n),this._drainQueue()}_drainQueue(e=!1){if(!this.connected||this._queue.length===0)return;const t=this._queue[0];t.pending&&!e||(t.pending=!0,t.tryCount++,this.flags=t.flags,this.emit.apply(this,t.args))}packet(e){e.nsp=this.nsp,this.io._packet(e)}onopen(){typeof this.auth=="function"?this.auth(e=>{this._sendConnectPacket(e)}):this._sendConnectPacket(this.auth)}_sendConnectPacket(e){this.packet({type:Ne.CONNECT,data:this._pid?Object.assign({pid:this._pid,offset:this._lastOffset},e):e})}onerror(e){this.connected||this.emitReserved("connect_error",e)}onclose(e,t){this.connected=!1,delete this.id,this.emitReserved("disconnect",e,t),this._clearAcks()}_clearAcks(){Object.keys(this.acks).forEach(e=>{if(!this.sendBuffer.some(n=>String(n.id)===e)){const n=this.acks[e];delete this.acks[e],n.withError&&n.call(this,new Error("socket has been disconnected"))}})}onpacket(e){if(e.nsp===this.nsp)switch(e.type){case Ne.CONNECT:e.data&&e.data.sid?this.onconnect(e.data.sid,e.data.pid):this.emitReserved("connect_error",new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));break;case Ne.EVENT:case Ne.BINARY_EVENT:this.onevent(e);break;case Ne.ACK:case Ne.BINARY_ACK:this.onack(e);break;case Ne.DISCONNECT:this.ondisconnect();break;case Ne.CONNECT_ERROR:this.destroy();const n=new Error(e.data.message);n.data=e.data.data,this.emitReserved("connect_error",n);break}}onevent(e){const t=e.data||[];e.id!=null&&t.push(this.ack(e.id)),this.connected?this.emitEvent(t):this.receiveBuffer.push(Object.freeze(t))}emitEvent(e){if(this._anyListeners&&this._anyListeners.length){const t=this._anyListeners.slice();for(const n of t)n.apply(this,e)}super.emit.apply(this,e),this._pid&&e.length&&typeof e[e.length-1]=="string"&&(this._lastOffset=e[e.length-1])}ack(e){const t=this;let n=!1;return function(...s){n||(n=!0,t.packet({type:Ne.ACK,id:e,data:s}))}}onack(e){const t=this.acks[e.id];typeof t=="function"&&(delete this.acks[e.id],t.withError&&e.data.unshift(null),t.apply(this,e.data))}onconnect(e,t){this.id=e,this.recovered=t&&this._pid===t,this._pid=t,this.connected=!0,this.emitBuffered(),this._drainQueue(!0),this.emitReserved("connect")}emitBuffered(){this.receiveBuffer.forEach(e=>this.emitEvent(e)),this.receiveBuffer=[],this.sendBuffer.forEach(e=>{this.notifyOutgoingListeners(e),this.packet(e)}),this.sendBuffer=[]}ondisconnect(){this.destroy(),this.onclose("io server disconnect")}destroy(){this.subs&&(this.subs.forEach(e=>e()),this.subs=void 0),this.io._destroy(this)}disconnect(){return this.connected&&this.packet({type:Ne.DISCONNECT}),this.destroy(),this.connected&&this.onclose("io client disconnect"),this}close(){return this.disconnect()}compress(e){return this.flags.compress=e,this}get volatile(){return this.flags.volatile=!0,this}timeout(e){return this.flags.timeout=e,this}onAny(e){return this._anyListeners=this._anyListeners||[],this._anyListeners.push(e),this}prependAny(e){return this._anyListeners=this._anyListeners||[],this._anyListeners.unshift(e),this}offAny(e){if(!this._anyListeners)return this;if(e){const t=this._anyListeners;for(let n=0;n<t.length;n++)if(e===t[n])return t.splice(n,1),this}else this._anyListeners=[];return this}listenersAny(){return this._anyListeners||[]}onAnyOutgoing(e){return this._anyOutgoingListeners=this._anyOutgoingListeners||[],this._anyOutgoingListeners.push(e),this}prependAnyOutgoing(e){return this._anyOutgoingListeners=this._anyOutgoingListeners||[],this._anyOutgoingListeners.unshift(e),this}offAnyOutgoing(e){if(!this._anyOutgoingListeners)return this;if(e){const t=this._anyOutgoingListeners;for(let n=0;n<t.length;n++)if(e===t[n])return t.splice(n,1),this}else this._anyOutgoingListeners=[];return this}listenersAnyOutgoing(){return this._anyOutgoingListeners||[]}notifyOutgoingListeners(e){if(this._anyOutgoingListeners&&this._anyOutgoingListeners.length){const t=this._anyOutgoingListeners.slice();for(const n of t)n.apply(this,e.data)}}}function Yi(i){i=i||{},this.ms=i.min||100,this.max=i.max||1e4,this.factor=i.factor||2,this.jitter=i.jitter>0&&i.jitter<=1?i.jitter:0,this.attempts=0}Yi.prototype.duration=function(){var i=this.ms*Math.pow(this.factor,this.attempts++);if(this.jitter){var e=Math.random(),t=Math.floor(e*this.jitter*i);i=(Math.floor(e*10)&1)==0?i-t:i+t}return Math.min(i,this.max)|0};Yi.prototype.reset=function(){this.attempts=0};Yi.prototype.setMin=function(i){this.ms=i};Yi.prototype.setMax=function(i){this.max=i};Yi.prototype.setJitter=function(i){this.jitter=i};class qo extends pt{constructor(e,t){var n;super(),this.nsps={},this.subs=[],e&&typeof e=="object"&&(t=e,e=void 0),t=t||{},t.path=t.path||"/socket.io",this.opts=t,cr(this,t),this.reconnection(t.reconnection!==!1),this.reconnectionAttempts(t.reconnectionAttempts||1/0),this.reconnectionDelay(t.reconnectionDelay||1e3),this.reconnectionDelayMax(t.reconnectionDelayMax||5e3),this.randomizationFactor((n=t.randomizationFactor)!==null&&n!==void 0?n:.5),this.backoff=new Yi({min:this.reconnectionDelay(),max:this.reconnectionDelayMax(),jitter:this.randomizationFactor()}),this.timeout(t.timeout==null?2e4:t.timeout),this._readyState="closed",this.uri=e;const s=t.parser||Kg;this.encoder=new s.Encoder,this.decoder=new s.Decoder,this._autoConnect=t.autoConnect!==!1,this._autoConnect&&this.open()}reconnection(e){return arguments.length?(this._reconnection=!!e,e||(this.skipReconnect=!0),this):this._reconnection}reconnectionAttempts(e){return e===void 0?this._reconnectionAttempts:(this._reconnectionAttempts=e,this)}reconnectionDelay(e){var t;return e===void 0?this._reconnectionDelay:(this._reconnectionDelay=e,(t=this.backoff)===null||t===void 0||t.setMin(e),this)}randomizationFactor(e){var t;return e===void 0?this._randomizationFactor:(this._randomizationFactor=e,(t=this.backoff)===null||t===void 0||t.setJitter(e),this)}reconnectionDelayMax(e){var t;return e===void 0?this._reconnectionDelayMax:(this._reconnectionDelayMax=e,(t=this.backoff)===null||t===void 0||t.setMax(e),this)}timeout(e){return arguments.length?(this._timeout=e,this):this._timeout}maybeReconnectOnOpen(){!this._reconnecting&&this._reconnection&&this.backoff.attempts===0&&this.reconnect()}open(e){if(~this._readyState.indexOf("open"))return this;this.engine=new kg(this.uri,this.opts);const t=this.engine,n=this;this._readyState="opening",this.skipReconnect=!1;const s=Qt(t,"open",function(){n.onopen(),e&&e()}),r=a=>{this.cleanup(),this._readyState="closed",this.emitReserved("error",a),e?e(a):this.maybeReconnectOnOpen()},o=Qt(t,"error",r);if(this._timeout!==!1){const a=this._timeout,l=this.setTimeoutFn(()=>{s(),r(new Error("timeout")),t.close()},a);this.opts.autoUnref&&l.unref(),this.subs.push(()=>{this.clearTimeoutFn(l)})}return this.subs.push(s),this.subs.push(o),this}connect(e){return this.open(e)}onopen(){this.cleanup(),this._readyState="open",this.emitReserved("open");const e=this.engine;this.subs.push(Qt(e,"ping",this.onping.bind(this)),Qt(e,"data",this.ondata.bind(this)),Qt(e,"error",this.onerror.bind(this)),Qt(e,"close",this.onclose.bind(this)),Qt(this.decoder,"decoded",this.ondecoded.bind(this)))}onping(){this.emitReserved("ping")}ondata(e){try{this.decoder.add(e)}catch(t){this.onclose("parse error",t)}}ondecoded(e){lr(()=>{this.emitReserved("packet",e)},this.setTimeoutFn)}onerror(e){this.emitReserved("error",e)}socket(e,t){let n=this.nsps[e];return n?this._autoConnect&&!n.active&&n.connect():(n=new Uc(this,e,t),this.nsps[e]=n),n}_destroy(e){const t=Object.keys(this.nsps);for(const n of t)if(this.nsps[n].active)return;this._close()}_packet(e){const t=this.encoder.encode(e);for(let n=0;n<t.length;n++)this.engine.write(t[n],e.options)}cleanup(){this.subs.forEach(e=>e()),this.subs.length=0,this.decoder.destroy()}_close(){this.skipReconnect=!0,this._reconnecting=!1,this.onclose("forced close")}disconnect(){return this._close()}onclose(e,t){var n;this.cleanup(),(n=this.engine)===null||n===void 0||n.close(),this.backoff.reset(),this._readyState="closed",this.emitReserved("close",e,t),this._reconnection&&!this.skipReconnect&&this.reconnect()}reconnect(){if(this._reconnecting||this.skipReconnect)return this;const e=this;if(this.backoff.attempts>=this._reconnectionAttempts)this.backoff.reset(),this.emitReserved("reconnect_failed"),this._reconnecting=!1;else{const t=this.backoff.duration();this._reconnecting=!0;const n=this.setTimeoutFn(()=>{e.skipReconnect||(this.emitReserved("reconnect_attempt",e.backoff.attempts),!e.skipReconnect&&e.open(s=>{s?(e._reconnecting=!1,e.reconnect(),this.emitReserved("reconnect_error",s)):e.onreconnect()}))},t);this.opts.autoUnref&&n.unref(),this.subs.push(()=>{this.clearTimeoutFn(n)})}}onreconnect(){const e=this.backoff.attempts;this._reconnecting=!1,this.backoff.reset(),this.emitReserved("reconnect",e)}}const ns={};function cs(i,e){typeof i=="object"&&(e=i,i=void 0),e=e||{};const t=zg(i,e.path||"/socket.io"),n=t.source,s=t.id,r=t.path,o=ns[s]&&r in ns[s].nsps,a=e.forceNew||e["force new connection"]||e.multiplex===!1||o;let l;return a?l=new qo(n,e):(ns[s]||(ns[s]=new qo(n,e)),l=ns[s]),t.query&&!e.query&&(e.query=t.queryKey),l.socket(t.path,e)}Object.assign(cs,{Manager:qo,Socket:Uc,io:cs,connect:cs});class Jg{constructor(){const e=location.pathname.endsWith("/")?location.pathname.slice(0,-1):location.pathname.replace(/\/[^/]*$/,"");if(window.__SP_MODE){let t=null;try{t=JSON.parse(localStorage.getItem("searchle_user"))}catch{}let n=[];try{n=JSON.parse(localStorage.getItem("searchle_sp_played")||"[]")}catch{}const s=e.replace(/\/sp\/?$/,"")||"",o=new URLSearchParams(window.location.search).get("mode")||void 0;this.socket=cs(location.origin+"/sp",{path:s+"/socket.io",auth:{userId:(t==null?void 0:t.id)||"anon",playedWords:n,userJson:t?JSON.stringify({displayName:t.globalName||t.username,username:t.username}):null,mode:o},reconnection:!0,reconnectionDelay:2e3,reconnectionDelayMax:1e4,reconnectionAttempts:1/0,transports:["polling","websocket"]})}else this.socket=cs({path:e+"/socket.io",reconnection:!0,reconnectionDelay:2e3,reconnectionDelayMax:1e4,reconnectionAttempts:1/0,transports:["polling","websocket"]})}on(e,t){this.socket.on(e,t)}off(e,t){this.socket.off(e,t)}emit(e,t){this.socket.emit(e,t)}}const st={winDisplayDuration:6e3,gradient:{hueMax:120,hueMin:0,saturation:80,lightness:35,opacity:.9,minFillPercent:2,bgColor:"#111827"},platformColors:{tiktok:"#69C9D0",youtube:"#FF0000",discord:"#5865F2"},defaultPlatformColor:"#9147FF",defaults:{fontFamily:"'Inter', 'Segoe UI', sans-serif",textSize:72,scoreSize:63,bubbleSize:180,bubbleStyle:"rounded",volume:50},bubbleRadiusMap:{rounded:"36px",square:"0px",pill:"999px"},baseWidth:1800,timerInterval:1e3,transitions:{guessEnter:300,guessReorder:400,guessExit:200,bumpFlash:300,jackpotBump:350,jackpotCount:800,winSlideIn:400,staggerDelay:50},easing:{enter:"easeBackOut",reorder:"easeCubicInOut",exit:"easeQuadIn"},water:{idleAmplitude:2.5,idleFrequency:.02,idleSpeed:1.8,sloshFrequency:.03,sloshVelocityScale:.025,sloshPhaseScale:.008,maxAmplitude:6,amplitudeDamping:.97,amplitudeFollowRate:14,phaseDamping:.98,samples:12,sleepThreshold:.1,sleepFrameSkip:4},storageKey:"searchle-3-settings-v2"};function wl(i,e){const t=st.gradient,n=Math.log(i),s=Math.log(e),r=Math.min(n/s,1);return`hsla(${t.hueMax*(1-r)}, ${t.saturation}%, ${t.lightness}%, ${t.opacity})`}function Tl(i,e){const t=Math.log(i),n=Math.log(e),s=Math.min(t/n,1);return Math.max((1-s)*100,st.gradient.minFillPercent)}function Al(i,e){const t=st.gradient,n=Math.log(i),s=Math.log(e),r=Math.min(n/s,1),o=t.hueMax*(1-r);return{deep:`hsla(${o}, ${t.saturation}%, ${t.lightness-8}%, ${t.opacity})`,mid:`hsla(${o}, ${t.saturation-5}%, ${t.lightness}%, ${t.opacity})`,surface:`hsla(${o}, ${t.saturation-10}%, ${t.lightness+12}%, ${t.opacity-.1})`}}function si(i){return st.platformColors[i]||st.defaultPlatformColor}function Cl(i){return i===9999999?"???":i===100001?"100,000+":i.toLocaleString()}class Qg{constructor(e,t,n){this._canvas=e,this._ctx=e.getContext("2d"),this.fillPercent=n,this._colors=t,this._flat=!0,this.idleFade=0,this.flatten()}setFill(e,t){this.fillPercent=e,this._colors=t,this.flatten()}setAspectRatio(){}update(e,t,n){this._flat||this.flatten()}flatten(){const e=this._canvas,t=this._ctx,n=e.width,s=e.height;if(n===0||s===0){this._flat=!0;return}const r=s*(1-this.fillPercent/100),o=t.createLinearGradient(0,s,0,r);o.addColorStop(0,this._colors.deep),o.addColorStop(.5,this._colors.mid),o.addColorStop(1,this._colors.surface),t.clearRect(0,0,n,s),t.fillStyle=o,t.fillRect(0,r,n,s-r),t.beginPath(),t.moveTo(0,r),t.lineTo(n,r),t.strokeStyle="rgba(255,255,255,0.15)",t.lineWidth=1.5,t.stroke(),this._flat=!0}dispose(){this._ctx=null,this._canvas&&this._canvas.parentNode&&this._canvas.parentNode.removeChild(this._canvas),this._canvas=null}}let Js={word_color:!1,word_glow:!1};function Yo(i){Js=i&&typeof i=="object"?{...i}:{word_color:!1,word_glow:!1}}const e_=80;function Yr(i,e){if(!i||!e||e<=0)return i;const t=e/e_;return Math.abs(t-1)<.05?i:i.replace(/(\d+(?:\.\d+)?)px/g,(n,s)=>Math.max(1,Math.round(parseFloat(s)*t))+"px")}const Rl=["-7px -7px 3px #000","7px -7px 3px #000","-7px  7px 3px #000","7px  7px 3px #000","0 -7px 3px #000","0  7px 3px #000","-7px  0 3px #000","7px  0 3px #000"].join(", ");function is(i){return i?Rl+", "+i:Rl}function Un(i,e){if(!e)return;e={...e};const t=i.avatarSize||i.avatarEl&&(i.avatarEl.offsetWidth||i.avatarEl.clientWidth)||0;if(Tt&&(delete e.word_color,delete e.word_glow),Js)for(const n of Object.keys(Js))Js[n]===!1&&delete e[n];if(e.word_color&&i.wordEl&&(e.word_color.color&&(i.wordEl.style.color=e.word_color.color,i.wordEl.style.webkitTextStroke="",i.wordEl.style.paintOrder="",i.wordEl.style.letterSpacing=""),i.wordEl.style.textShadow=is(e.word_color.textShadow||""),e.word_color.animation&&(i.wordEl.style.animation=e.word_color.animation)),e.word_glow&&i.wordEl){if(e.word_glow.textShadow){const n=i.wordEl.style.textShadow;i.wordEl.style.textShadow=n?n+", "+e.word_glow.textShadow:is(e.word_glow.textShadow)}e.word_glow.animation&&!i.wordEl.style.animation&&(i.wordEl.style.animation=e.word_glow.animation)}if(e.profile_border&&i.avatarEl&&(e.profile_border.border&&(i.avatarEl.style.border=Yr(e.profile_border.border,t)),e.profile_border.boxShadow&&(i.avatarEl.dataset.borderShadow=Yr(e.profile_border.boxShadow,t)),e.profile_border.animation&&(i.avatarEl.style.animation=e.profile_border.animation)),e.profile_glow&&i.avatarEl){const n=i.avatarEl.dataset.borderShadow||"",s=Yr(e.profile_glow.boxShadow,t),r=[n,s].filter(Boolean).join(", ");i.avatarEl.style.boxShadow=r,e.profile_glow.animation&&!i.avatarEl.style.animation&&(i.avatarEl.style.animation=e.profile_glow.animation)}else e.profile_border&&i.avatarEl&&i.avatarEl.dataset.borderShadow&&(i.avatarEl.style.boxShadow=i.avatarEl.dataset.borderShadow);if(e.name_color&&i.nameEl&&(e.name_color.color&&(i.nameEl.style.color=e.name_color.color),i.nameEl.style.textShadow=is(e.name_color.textShadow||""),e.name_color.animation&&(i.nameEl.style.animation=e.name_color.animation)),e.name_glow&&i.nameEl){if(e.name_glow.textShadow){const n=i.nameEl.style.textShadow;i.nameEl.style.textShadow=n?n+", "+e.name_glow.textShadow:is(e.name_glow.textShadow)}e.name_glow.animation&&!i.nameEl.style.animation&&(i.nameEl.style.animation=e.name_glow.animation)}if(e.hero_badge&&i.surfaceEl&&e.hero_badge.background&&(i.surfaceEl.style.background=e.hero_badge.background,e.hero_badge.backgroundSize&&(i.surfaceEl.style.backgroundSize=e.hero_badge.backgroundSize),e.hero_badge.animation&&(i.surfaceEl.style.animation=e.hero_badge.animation)),e.title&&e.title.title&&i.titleContainer){const n=document.createElement("span");n.className="cosmetic-title",n.textContent=" ["+e.title.title+"]",e.title.titleColor&&(n.style.color=e.title.titleColor),n.style.textShadow=is(e.title.titleGlow||""),e.title.animation&&(n.style.animation=e.title.animation),i.titleContainer.appendChild(n)}}class wt{constructor(e,t,n,s){this.word=e.word,this.rank=e.rank,this._userId=e.user?e.user.platformUserId||e.user.id:null,this._linkedDiscord=e.user&&e.user.linkedDiscord||null,this.element=this._buildElement(e,t,n,s),this.object3D={position:{x:0,y:0,z:0,set(r,o,a){this.x=r,this.y=o,this.z=a}},rotation:{x:0,y:0,z:0},visible:!0,parent:null},this._rankEl=this.element.querySelector(".guess-rank"),this._wordEl=this.element.querySelector(".guess-word"),this._userEl=this.element.querySelector(".guess-user"),this._motionActive=!1}_buildElement(e,t,n,s){const r=document.createElement("div");r.className="guess-entry",r.style.background=st.gradient.bgColor,r.style.outline=`9px solid ${wl(e.rank,t)}`;const o=document.createElement("canvas");o.className="rank-bar-svg";const a=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bubble-height"))||216,l=st.baseWidth-144,c=Li||Tt?4:2;o.width=l/c|0,o.height=a/c|0;const d=l/a;this._water=new Qg(o,Al(e.rank,t),Tl(e.rank,t),d),r.appendChild(o);const f=document.createElement("span");f.className="guess-word",f.textContent=e.word;const u=document.createElement("span");u.className="guess-user";const p=document.createElement("span");if(p.className="guess-pic-wrap",e.lastBumper&&e.lastBumper.profilePic){const h=document.createElement("img");h.src=e.lastBumper.profilePic,h.className="bumper-pic",h.alt=e.lastBumper.displayName||"",h.onerror=function(){const w=wt._createFallbackPic(e.lastBumper.displayName||"?",e.lastBumper.platform);w.className="bumper-pic bumper-pic-fallback",this.replaceWith(w)},p.appendChild(h)}else if(e.lastBumper){const h=wt._createFallbackPic(e.lastBumper.displayName||"?",e.lastBumper.platform);h.classList.add("bumper-pic"),p.appendChild(h)}if(e.user.profilePic){const h=document.createElement("img");h.src=e.user.profilePic,h.className="user-pic",h.alt=e.user.displayName,h.onerror=function(){const w=wt._createFallbackPic(e.user.displayName,e.user.platform);this.replaceWith(w)},p.appendChild(h)}else p.appendChild(wt._createFallbackPic(e.user.displayName,e.user.platform));u.appendChild(p);const g=document.createElement("span");g.className="user-name",g.textContent=e.user.displayName,e.user.customColor&&(g.style.color=e.user.customColor),u.appendChild(g);const x=wt._createPlatformIcon(e.user.platform);x&&u.appendChild(x);const m=document.createElement("span");if(m.className="guess-rank",m.textContent=Cl(e.rank),r.appendChild(f),r.appendChild(u),r.appendChild(m),e.user.cosmetics){const h=u.querySelector(".user-pic")||u.querySelector(".user-pic-fallback");Un({nameEl:g,avatarEl:h,wordEl:f,titleContainer:u,avatarSize:153},e.user.cosmetics),this._lastCosSignature=wt._cosmeticsSignature(e.user.cosmetics)}return r}applyCosmeticsRetro(e){if(!e||!this.element)return;const t=this.element.querySelector(".guess-user");if(!t)return;const n=t.querySelector(".user-pic")||t.querySelector(".user-pic-fallback"),s=t.querySelector(".user-name"),r=this.element.querySelector(".guess-word");Un({nameEl:s,avatarEl:n,wordEl:r,titleContainer:t,avatarSize:153},e),this._lastCosSignature=wt._cosmeticsSignature(e)}updateRank(e,t){this.rank=e,this._water&&this._water.setFill(Tl(e,t),Al(e,t)),this._rankEl&&(this._rankEl.textContent=Cl(e)),this.element.style.outlineColor=wl(e,t)}updateWinBadge(e,t){if(window.__SP_MODE||!this._userId)return;const n=this.element.querySelector(".user-pic-wrap");if(!n)return;const s=t||{},r=s[this._linkedDiscord]||s[this._userId]||0,o=e?wt._countUserWins(e,this._userId,this._linkedDiscord):0,a=Math.max(r,o);let l=n.querySelector(".guess-win-badge");a>0?(l||(l=document.createElement("span"),l.className="guess-win-badge",n.appendChild(l)),l.textContent=a):l&&l.remove()}applySecondaryMotion(e,t){if(Math.abs(e)<2&&Math.abs(t)<2){this._motionActive&&(this._wordEl&&(this._wordEl.style.transform=""),this._rankEl&&(this._rankEl.style.transform=""),this._userEl&&(this._userEl.style.transform=""),this._motionActive=!1);return}this._motionActive=!0;const s=Math.max(-8,Math.min(8,-e*.025)),r=Math.max(-5,Math.min(5,-t*.015));this._wordEl&&(this._wordEl.style.transform=`translate(${s}px, ${r}px)`),this._rankEl&&(this._rankEl.style.transform=`translate(${s*1.3}px, ${r*1.3}px)`),this._userEl&&(this._userEl.style.transform=`translate(${s*.7}px, ${r*.7}px)`)}updateWater(e,t,n){this._water&&this._water.update(e,t,n)}flattenWater(){this._water&&this._water.flatten()}dispose(){this._water&&(this._water.dispose(),this._water=null),this.element.parentNode&&this.element.parentNode.removeChild(this.element),this.object3D=null}static _countUserWins(e,t,n){let s=0;for(const r of e){const o=r.user?r.user.platformUserId||r.user.id:r.userId,a=r.user?r.user.linkedDiscord:null;if(o===t){s++;continue}if(n&&a&&a===n){s++;continue}if(n&&o===n){s++;continue}if(a&&a===t){s++;continue}}return s}static _createFallbackPic(e,t){const n=document.createElement("div");return n.className="user-pic-fallback",n.style.backgroundColor=si(t),n.textContent=(e||"?")[0].toUpperCase(),n}static _createPlatformIcon(e,t=63){const n=document.createElementNS("http://www.w3.org/2000/svg","svg");n.setAttribute("width",t),n.setAttribute("height",t),n.setAttribute("viewBox","0 0 24 24"),n.setAttribute("fill","none"),n.classList.add("platform-icon");const s=document.createElementNS("http://www.w3.org/2000/svg","path");if(e==="tiktok")s.setAttribute("d","M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.7a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.13Z"),s.setAttribute("fill","#69C9D0");else if(e==="youtube")s.setAttribute("d","M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"),s.setAttribute("fill","#FF0000");else if(e==="discord")s.setAttribute("d","M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.27 18.27 0 0 0-5.4 0 12.6 12.6 0 0 0-.62-1.26.07.07 0 0 0-.08-.04 19.74 19.74 0 0 0-4.93 1.51.07.07 0 0 0-.03.03C1.07 8.93.32 13.35.79 17.71a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.12c.13-.09.25-.19.37-.29a.07.07 0 0 1 .07-.01c3.93 1.79 8.18 1.79 12.07 0a.07.07 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.88.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.07.07 0 0 0 .08.03 19.83 19.83 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.56-5.01-.87-9.4-3.78-13.31a.06.06 0 0 0-.03-.03ZM8.02 15.07c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.17 1.1 2.15 2.42 0 1.34-.95 2.42-2.15 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.17 1.1 2.15 2.42 0 1.34-.94 2.42-2.15 2.42Z"),s.setAttribute("fill","#5865F2");else return null;return n.appendChild(s),n}static _cosmeticsSignature(e){const t=n=>{if(Array.isArray(n))return n.map(t);if(n&&typeof n=="object"){const s={};for(const r of Object.keys(n).sort())s[r]=t(n[r]);return s}return n};try{return JSON.stringify(t(e||{}))}catch{return""}}}const ss=14,$r=.5,jr=.3;class t_{constructor(e,t){this.domRenderer=e,this.anim=t,this.entries=new Map,this._springs=new Map,this._exiting=new Map,this._virtualPool=new Map,this.topOffset=0,this._scrollY=0,this._viewHeight=3600,this._cachedRowH=0,this._hadEntries=!1,this._centerX=st.baseWidth/2,this._lastTotalRankedWords=0,this._lastWinHistory=null,this._drawerOffset=0,this._drawerTarget=0,this._groupY=0}setViewHeight(e){this._viewHeight=e}_updateGroupY(){const e=-(this.topOffset+this._drawerOffset-this._scrollY);this._groupY=e,this.domRenderer.setGroupY(e)}setTopOffset(e){this.topOffset=e,this._updateGroupY()}setScrollY(e){this._scrollY=e,this._updateGroupY()}setDrawerOffset(e){this._drawerTarget=e}get drawerOffset(){return this._drawerOffset}getScrollY(){return this._scrollY}getMaxScroll(){const e=this.entries.size+this._virtualPool.size;return Math.max(0,e*this.getRowHeight()-this._viewHeight+this.topOffset)}getRowHeight(){if(!this._cachedRowH){const e=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bubble-height"))||216;this._cachedRowH=e+27}return this._cachedRowH}invalidateRowHeight(){this._cachedRowH=0}_getEntryZ(e){return e>=10?0:25-e*2.5}_detachEntry(e,t){t.detached=!0,this.domRenderer.remove(e.element)}_reattachEntry(e,t){t.detached=!1,this.domRenderer.addToGroup(e.element),e.element.style.visibility==="hidden"&&(e.element.style.visibility="");const n=e.object3D;this.domRenderer.applyTransform(e.element,n.position.x,n.position.y,n.position.z,n.rotation.x,n.rotation.y),e.flattenWater()}_materializeEntry(e,t){const n=new wt(t.guess,this._lastTotalRankedWords,this._lastWinHistory,this._lastWinCounts);n.element.style.width=st.baseWidth-144+"px",n.object3D.position.set(this._centerX,t.ty,t.tz),n.element.style.opacity="1",n.flattenWater(),this.domRenderer.addToGroup(n.element),this.domRenderer.applyTransform(n.element,t.tx,t.ty,t.tz,0,0),this.entries.set(e,n),this._springs.set(e,{tx:this._centerX,ty:t.ty,tz:t.tz,vx:0,vy:0,vz:0,sleeping:!0,detached:!1}),this._virtualPool.delete(e)}update(e){const t=Math.min(e,.033),n=this._drawerTarget-this._drawerOffset;Math.abs(n)>.5?(this._drawerOffset+=n*Math.min(1,10*t),this._updateGroupY()):n!==0&&(this._drawerOffset=this._drawerTarget,this._updateGroupY());const s=this.getRowHeight(),o=(this.entries.size+this._virtualPool.size)*s+this.topOffset,a=Math.max(this._viewHeight,o),l=-Math.max(this._viewHeight*2,o+this._viewHeight),c=-this.topOffset+2*this._drawerOffset-72;for(const[f,u]of this.entries){const p=this._springs.get(f);if(!p)continue;if(p.detached){const S=-(this.topOffset-this._scrollY)+p.ty;S>l&&S<a&&S<c&&this._reattachEntry(u,p);continue}if(p.settling){const S=-(this.topOffset-this._scrollY)+u.object3D.position.y;if(!(S>l&&S<a)||S>c)u._water&&u._water.flatten(),p.settling=!1,this._detachEntry(u,p);else{const y=u._water;y?(y.update(t,0,0),typeof y.idleFade<"u"?(y.idleFade=Math.max(0,y.idleFade-t*3),y.idleFade<=0&&(y.flatten(),p.settling=!1)):y._flat&&(p.settling=!1)):p.settling=!1}continue}if(p.sleeping){const S=-(this.topOffset-this._scrollY)+p.ty;(!(S>l&&S<a)||S>c)&&this._detachEntry(u,p);continue}const g=u.object3D,x=g.position.x-p.tx;p.vx+=(-180*x-ss*p.vx)*t,g.position.x+=p.vx*t;const m=g.position.y-p.ty;p.vy+=(-180*m-ss*p.vy)*t,g.position.y+=p.vy*t;const h=g.position.z-p.tz;p.vz+=(-180*h-ss*p.vz)*t,g.position.z+=p.vz*t;const w=Math.abs(p.vx),b=Math.abs(p.vy),M=Math.abs(p.vz);if(w<$r&&b<$r&&M<$r&&Math.abs(x)<jr&&Math.abs(m)<jr&&Math.abs(h)<jr){g.position.x=p.tx,g.position.y=p.ty,g.position.z=p.tz,p.vx=0,p.vy=0,p.vz=0,g.rotation.x=0,g.rotation.y=0,u.applySecondaryMotion(0,0),this.domRenderer.applyTransform(u.element,p.tx,p.ty,p.tz,0,0),u.element.style.visibility==="hidden"&&(u.element.style.visibility=""),p.sleeping=!0,p.settling=!0;continue}g.rotation.y=Math.max(-.15,Math.min(.15,-p.vx*3e-4)),g.rotation.x=Math.max(-.08,Math.min(.08,p.vy*3e-4)),u.applySecondaryMotion(p.vx,p.vy),this.domRenderer.applyTransform(u.element,g.position.x,g.position.y,g.position.z,g.rotation.x,g.rotation.y);const I=-(this.topOffset-this._scrollY)+g.position.y,P=I>c;P?u.element.style.visibility!=="hidden"&&(u.element.style.visibility="hidden"):u.element.style.visibility==="hidden"&&(u.element.style.visibility="");const A=I>l&&I<a&&!P,U=w>5||b>5;(A||U)&&u.updateWater(t,p.vx,p.vy)}let d=0;for(const[f,u]of this._virtualPool){const p=-(this.topOffset-this._scrollY)+u.ty;if(p>l&&p<a&&p<c&&(this._materializeEntry(f,u),++d>=3))break}for(const[f,u]of this._exiting){const{entry:p,spring:g}=u;if(!g)continue;const x=p.object3D,m=x.position.x-g.tx;g.vx+=(-180*.5*m-ss*.7*g.vx)*t,x.position.x+=g.vx*t;const h=x.position.y-g.ty;g.vy+=(-180*.5*h-ss*.7*g.vy)*t,x.position.y+=g.vy*t,x.rotation.y=-g.vx*.003,p.applySecondaryMotion(g.vx,g.vy),p.updateWater(t,g.vx,g.vy),this.domRenderer.applyTransform(p.element,x.position.x,x.position.y,x.position.z,0,x.rotation.y)}}applyCosmeticsToAll(e){for(const t of this.entries.values())t.applyCosmeticsRetro(e)}updateList(e,t,n,s){const r=e.slice().sort((u,p)=>u.rank-p.rank),o=this.getRowHeight(),a=o/2,l=this._hadEntries;this._lastWinHistory,this._lastTotalRankedWords=t,this._lastWinHistory=n,this._lastWinCounts=s||{};const c=new Map;r.forEach((u,p)=>c.set(u.word,p));const d=new Set(r.map(u=>u.word)),f=new Set(this.entries.keys());for(const u of f)if(!d.has(u)){const p=this.entries.get(u),g=this._springs.get(u);this._startExit(u,p,g),this.entries.delete(u),this._springs.delete(u)}for(const u of this._virtualPool.keys())d.has(u)||this._virtualPool.delete(u);for(const u of r){const p=c.get(u.word),g=-(p*o+a),x=this._getEntryZ(p);if(this.entries.has(u.word)){const m=this.entries.get(u.word);if(m.updateRank(u.rank,t),u.user&&u.user.cosmetics){const w=wt._cosmeticsSignature(u.user.cosmetics),b=m._lastCosSignature||"";w!==b&&m.applyCosmeticsRetro(u.user.cosmetics)}const h=this._springs.get(u.word);h&&((h.ty!==g||h.tz!==x)&&(h.sleeping=!1,h.settling=!1,h.detached&&this._reattachEntry(m,h)),h.ty=g,h.tz=x)}else if(this._virtualPool.has(u.word)){const m=this._virtualPool.get(u.word);m.ty=g,m.tz=x,m.guess=u}else if(l){const m=new wt(u,t,n,this._lastWinCounts);m.element.style.width=st.baseWidth-144+"px",this.entries.set(u.word,m),this.domRenderer.addToGroup(m.element);const h=this._centerX+900;m.object3D.position.set(h,g,x+180),m.element.style.opacity="1",this.domRenderer.applyTransform(m.element,h,g,x+180,0,0),this._springs.set(u.word,{tx:this._centerX,ty:g,tz:x,vx:0,vy:0,vz:0,sleeping:!1,detached:!1});let w=0;for(const[b,M]of this._springs){if(b===u.word)continue;const I=Math.abs(M.ty-g);if(I<o*3){if(M.vy-=30*(1-I/(o*3)),M.sleeping=!1,M.settling=!1,M.detached){const P=this.entries.get(b);P&&this._reattachEntry(P,M)}if(++w>=8)break}}}else{const m=-(this.topOffset-this._scrollY)+g;if(m>-(this._viewHeight+450)&&m<450){const w=new wt(u,t,n,this._lastWinCounts);w.element.style.width=st.baseWidth-144+"px",w.object3D.position.set(this._centerX,g,x),w.element.style.opacity="1",w.flattenWater(),this.domRenderer.addToGroup(w.element),this.domRenderer.applyTransform(w.element,this._centerX,g,x,0,0),this.entries.set(u.word,w),this._springs.set(u.word,{tx:this._centerX,ty:g,tz:x,vx:0,vy:0,vz:0,sleeping:!0,detached:!1})}else this._virtualPool.set(u.word,{guess:u,tx:this._centerX,ty:g,tz:x})}}this._hadEntries=r.length>0||l}_startExit(e,t,n){if(n&&n.detached){t.dispose();return}n&&(n.tx=this._centerX-1350,this._exiting.set(e,{entry:t,spring:n})),t.element.style.transition="opacity 400ms ease-out",t.element.style.opacity="0",setTimeout(()=>{t.dispose(),this._exiting.delete(e)},450)}}class n_{constructor(e){this.domRenderer=e,this.currentObject=null,this._entry=null,this._settling=!1,this.yPosition=0,this._scrollY=0,this._drawerOffset=0,this._drawerTarget=0}setDrawerOffset(e){this._drawerTarget=e}setPosition(e){if(this.yPosition=e,this.currentObject&&!this._settling){const t=st.baseWidth/2,n=-(this.yPosition+this._drawerOffset+108);this.currentObject.position.set(t,n,40),this.domRenderer.applyTransform(this._entry.element,t,n,40,0,this.currentObject.rotation.y)}}update(e,t,n,s){if(this._entry&&(this.domRenderer.remove(this._entry.element),this.currentObject=null),e.length===0)return;const r=e[e.length-1],o=new wt(r,t,n,s);if(o.element.style.width=st.baseWidth-72+"px",o.element.classList.add("pinned-guess-entry"),!window.__SP_MODE&&r.user){const l=r.user.platformUserId||r.user.id,c=r.user.linkedDiscord||null;if(l){const d=s||{},f=d[c]||d[l]||0,u=n?wt._countUserWins(n,l,c):0,p=Math.max(f,u);if(p>0){const g=o.element.querySelector(".guess-pic-wrap");if(g){const x=document.createElement("span");x.className="guess-win-badge",x.textContent=p,g.appendChild(x)}}}}o._water&&(o._water.tilt=-.55),this._entry=o,this._settling=!0,this._springDisp=900,this._springVx=0,this.currentObject=o.object3D,this._targetX=st.baseWidth/2;const a=-(this.yPosition+this._drawerOffset+108);this.currentObject.position.set(this._targetX+900,a,40),this.domRenderer.add(o.element),this.domRenderer.applyTransform(o.element,this._targetX+900,a,40,0,0)}animate(e){const t=this._drawerTarget-this._drawerOffset;if(Math.abs(t)>.5){if(this._drawerOffset+=t*Math.min(1,10*e),this.currentObject&&!this._settling){const r=-(this.yPosition+this._drawerOffset+108);this.currentObject.position.y=r,this.domRenderer.applyTransform(this._entry.element,this.currentObject.position.x,r,this.currentObject.position.z,0,this.currentObject.rotation.y)}}else if(t!==0&&(this._drawerOffset=this._drawerTarget,this.currentObject&&!this._settling)){const r=-(this.yPosition+this._drawerOffset+108);this.currentObject.position.y=r,this.domRenderer.applyTransform(this._entry.element,this.currentObject.position.x,r,this.currentObject.position.z,0,this.currentObject.rotation.y)}if(!this._settling||!this.currentObject)return;const n=this.currentObject;n.position.y=-(this.yPosition+this._drawerOffset+108);const s=n.position.x-this._targetX;if(this._springVx+=(-180*s-14*this._springVx)*e,n.position.x+=this._springVx*e,n.rotation.y=Math.max(-.15,Math.min(.15,-this._springVx*3e-4)),this._entry.applySecondaryMotion(this._springVx,0),this._entry._water&&this._entry._water.update(e,this._springVx,0),this.domRenderer.applyTransform(this._entry.element,n.position.x,n.position.y,n.position.z,0,n.rotation.y),Math.abs(this._springVx)<.5&&Math.abs(s)<.3){n.position.x=this._targetX,n.rotation.y=0,this._springVx=0,this._entry.applySecondaryMotion(0,0);const r=this._entry._water;(!r||r._flat)&&(this._settling=!1)}}flashBump(e,t){if(!this.currentObject)return;const n=this.currentObject.element;n&&(n.classList.remove("bumped"),n.offsetWidth,n.classList.add("bumped"))}clear(){this._entry&&(this.domRenderer.remove(this._entry.element),this.currentObject=null,this._entry=null),this._settling=!1}}class ua{constructor(e){this.domRenderer=e,this.timerInterval=null,this.startTime=null,this.isWon=!1,this.winHistory=[],this.mode=null,this.drawerOpen=!1,this.onDrawerToggle=null,this.element=this._buildElement(),this.object3D=e.makeObject(this.element),this.object3D.position.set(st.baseWidth/2,-215,0),e.add(this.element),this.guessCountEl=this.element.querySelector(".header-value-guesses"),this.timerEl=this.element.querySelector(".header-value-timer"),this.winnerNameEl=this.element.querySelector(".header-winner-name"),this.winnerWordEl=this.element.querySelector(".header-winner-word"),this.winnerGuessesEl=this.element.querySelector(".header-winner-guesses"),this.winnerPicEl=this.element.querySelector(".header-winner-pic"),this.winnerPicFbEl=this.element.querySelector(".header-winner-pic-fb"),this.winnerWinsEl=this.element.querySelector(".header-winner-wins"),this.winnerSurfaceEl=this.element.querySelector(".header-winner"),this.bannerLayerEl=this.element.querySelector(".header-banner-layer"),this.wordNumEl=this.element.querySelector(".header-winner-word-num"),this.drawerEl=this.element.querySelector(".stats-drawer"),this.drawerContentEl=this.element.querySelector(".stats-drawer-content"),this.statsToggleEl=this.element.querySelector(".stats-toggle"),this.statsToggleChevron=this.element.querySelector(".stats-toggle-chevron");const t=this.element.querySelector(".header-winner-pic-wrap");t&&t.addEventListener("click",()=>{window.location.href="https://wordtycoon.live"}),this.statsToggleEl&&this.statsToggleEl.addEventListener("click",n=>{n.stopPropagation(),this._toggleDrawer()}),this._createBannerOverlay()}_buildElement(){const e=document.createElement("div");return e.className="header-bar",e.style.width=st.baseWidth+"px",e.innerHTML=`
      <div class="header-banner-layer"></div>
      <div class="header-bar-row">
        <div class="header-winner">
          <div class="header-winner-pic-wrap" style="cursor:pointer;" title="Game Hub">
            <img class="header-winner-pic hidden" src="" alt="">
            <div class="header-winner-pic-fb hidden"></div>
            <span class="header-winner-wins hidden"></span>
          </div>
          <div class="header-winner-info">
            <span class="header-winner-name">--</span>
            <span class="header-winner-word"></span>
            <span class="header-winner-guesses"></span>
            <span class="header-winner-word-num hidden"></span>
          </div>
        </div>
        <div class="header-stats">
          <div class="header-stat">
            <span class="header-label">Guesses</span>
            <span class="header-value header-value-guesses">0</span>
          </div>
          <div class="header-stat">
            <span class="header-label">Time</span>
            <span class="header-value header-value-timer">0:00</span>
          </div>
          <div class="header-stat stats-toggle" title="Toggle Stats">
            <span class="stats-toggle-icon">&#9776;</span>
            <span class="header-label stats-toggle-label">Stats</span>
            <span class="stats-toggle-chevron">&#9660;</span>
          </div>
        </div>
      </div>
      <div class="stats-drawer">
        <div class="stats-drawer-content"></div>
      </div>
    `,e}get height(){const e=this.element.querySelector(".header-bar-row");return(e?e.offsetHeight:0)||360}updateGuessCount(e){this.guessCountEl&&(this.guessCountEl.textContent=e)}startTimer(e){this.startTime=e,this.isWon=!1,this.timerInterval&&clearInterval(this.timerInterval),this.timerInterval=setInterval(()=>{if(!this.startTime||this.isWon)return;const t=Math.floor((Date.now()-new Date(this.startTime).getTime())/1e3),n=Math.floor(t/60),s=t%60;this.timerEl&&(this.timerEl.textContent=n+":"+s.toString().padStart(2,"0"))},st.timerInterval)}stopTimer(){this.isWon=!0}updateWinner(e,t,n,s,r){if(this.winHistory=s||this.winHistory,this.winnerNameEl&&(this.winnerNameEl.textContent=t.displayName,this.winnerNameEl.style.cssText=""),this.winnerWordEl&&(this.winnerWordEl.textContent=e),this.winnerGuessesEl&&n&&(this.winnerGuessesEl.textContent=n+(n===1?" guess":" guesses")),this.winnerWinsEl){const a=t.platformUserId||t.id,l=t.linkedDiscord||null,c=r||{},d=c[l]||c[a]||0,f=ua._countUserWins(this.winHistory,a,l),u=Math.max(d,f);u>0?(this.winnerWinsEl.textContent=u,this.winnerWinsEl.classList.remove("hidden")):this.winnerWinsEl.classList.add("hidden")}for(const a of[this.winnerPicEl,this.winnerPicFbEl])a.style.border="",a.style.boxShadow="",a.style.animation="",delete a.dataset.borderShadow;this.bannerLayerEl&&(this.bannerLayerEl.style.background="",this.bannerLayerEl.style.backgroundSize="",this.bannerLayerEl.style.animation=""),this.element.classList.remove("has-hero-badge"),t.profilePic?(this.winnerPicEl.src=t.profilePic,this.winnerPicEl.classList.remove("hidden"),this.winnerPicFbEl.classList.add("hidden"),this.winnerPicEl.onerror=()=>{this.winnerPicEl.classList.add("hidden"),this.winnerPicFbEl.classList.remove("hidden"),this.winnerPicFbEl.style.backgroundColor=si(t.platform),this.winnerPicFbEl.textContent=(t.displayName||"?")[0].toUpperCase(),t.cosmetics&&Un({avatarEl:this.winnerPicFbEl,avatarSize:288},t.cosmetics)}):(this.winnerPicEl.classList.add("hidden"),this.winnerPicFbEl.classList.remove("hidden"),this.winnerPicFbEl.style.backgroundColor=si(t.platform),this.winnerPicFbEl.textContent=(t.displayName||"?")[0].toUpperCase());const o=t.cosmetics?Object.keys(t.cosmetics):[];if(console.log("[HeaderBar] cosmetics:",o.length?o.join(", "):"(empty)",t.cosmetics),t.cosmetics&&o.length>0){const a=t.profilePic?this.winnerPicEl:this.winnerPicFbEl;Un({avatarEl:a,nameEl:this.winnerNameEl,surfaceEl:this.bannerLayerEl,avatarSize:288},t.cosmetics),t.cosmetics.hero_badge&&this.element.classList.add("has-hero-badge")}}updateWordNumber(e,t){if(this.wordNumEl)if(e){const n=t==="daily"?"Daily #":t==="weekly"?"Weekly #":"Game #";this.wordNumEl.textContent=n+e,this.wordNumEl.classList.remove("hidden")}else this.wordNumEl.classList.add("hidden")}reset(e){this.updateGuessCount(0),this.timerEl&&(this.timerEl.textContent="0:00"),this.isWon=!1,this.updateWordNumber(null),this.startTimer(e)}setSPUser(e,t){for(const n of[this.winnerPicEl,this.winnerPicFbEl])n.style.border="none",n.style.boxShadow="none",n.style.animation="",delete n.dataset.borderShadow;if(this.winnerNameEl&&(this.winnerNameEl.textContent=e.displayName||e.username||"--",this.winnerNameEl.style.cssText=""),this.winnerWordEl&&(this.winnerWordEl.textContent=""),this.winnerGuessesEl&&(this.winnerGuessesEl.textContent=""),this.winnerWinsEl&&this.winnerWinsEl.classList.add("hidden"),e.profilePic?(this.winnerPicEl.src=e.profilePic,this.winnerPicEl.classList.remove("hidden"),this.winnerPicFbEl.classList.add("hidden"),this.winnerPicEl.onerror=()=>{this.winnerPicEl.classList.add("hidden"),this.winnerPicFbEl.classList.remove("hidden"),this.winnerPicFbEl.style.backgroundColor=si("discord"),this.winnerPicFbEl.textContent=(e.displayName||"?")[0].toUpperCase(),t&&Un({avatarEl:this.winnerPicFbEl,avatarSize:288},t)}):(this.winnerPicEl.classList.add("hidden"),this.winnerPicFbEl.classList.remove("hidden"),this.winnerPicFbEl.style.backgroundColor=si("discord"),this.winnerPicFbEl.textContent=(e.displayName||"?")[0].toUpperCase()),t&&Object.keys(t).length>0){const n=e.profilePic?this.winnerPicEl:this.winnerPicFbEl;Un({avatarEl:n,nameEl:this.winnerNameEl,avatarSize:288},t)}}setSPAnon(){for(const e of[this.winnerPicEl,this.winnerPicFbEl])e.style.border="none",e.style.boxShadow="none",e.style.animation="",delete e.dataset.borderShadow;this.winnerPicEl.classList.add("hidden"),this.winnerPicFbEl.classList.add("hidden"),this.winnerNameEl&&(this.winnerNameEl.textContent="Guest",this.winnerNameEl.style.cssText=""),this.winnerWordEl&&(this.winnerWordEl.textContent=""),this.winnerGuessesEl&&(this.winnerGuessesEl.textContent=""),this.winnerWinsEl&&this.winnerWinsEl.classList.add("hidden"),this._createLoginOverlay()}hideLoginOverlay(){this._loginOverlay&&(this._loginOverlay.remove(),this._loginOverlay=null)}_createLoginOverlay(){if(this._loginOverlay)return;const e=location.origin+"/auth/discord?returnTo="+encodeURIComponent(location.pathname),t=document.createElement("a");t.className="login-overlay-btn",t.href=e,t.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg><span>Log in with Discord</span>',document.body.appendChild(t),this._loginOverlay=t}setMode(e){this.mode=e}_toggleDrawer(){if(this.drawerOpen=!this.drawerOpen,this.drawerEl&&this.drawerEl.classList.toggle("open",this.drawerOpen),this.statsToggleChevron&&(this.statsToggleChevron.style.transform=this.drawerOpen?"rotate(180deg)":""),this.statsToggleEl&&this.statsToggleEl.classList.toggle("active",this.drawerOpen),this._bannerOverlay&&this._bannerOverlay.classList.toggle("drawer-open",this.drawerOpen),this._drawerThemeBtn)if(this.drawerOpen){const e=this.element.querySelector(".header-bar-row");if(e){const t=e.getBoundingClientRect();this._drawerThemeBtn.style.top=t.bottom+8+"px"}this._drawerThemeBtn.classList.add("visible")}else this._drawerThemeBtn.classList.remove("visible");if(this.onDrawerToggle){const e=this.drawerOpen&&this.drawerEl?this.drawerEl.scrollHeight:0;this.onDrawerToggle(e)}}_createBannerOverlay(){const e=document.createElement("div");e.className="banner-overlay";const t=document.createElement("div");t.className="banner-pull-hint",t.textContent="▼",e.appendChild(t);let n=0,s=!1,r=!1;e.addEventListener("touchstart",l=>{n=l.touches[0].clientY,r=!1},{passive:!0}),e.addEventListener("touchmove",()=>{r=!0},{passive:!0}),e.addEventListener("touchend",l=>{s=!0;const c=l.changedTouches[0].clientY-n;c>30&&!this.drawerOpen?this._toggleDrawer():c<-30&&this.drawerOpen?this._toggleDrawer():r||this._toggleDrawer()},{passive:!0}),e.addEventListener("click",()=>{if(s){s=!1;return}this._toggleDrawer()}),document.body.appendChild(e),this._bannerOverlay=e;const o=document.createElement("div");o.className="drawer-theme-btn";const a=document.documentElement.dataset.theme==="light";o.innerHTML=a?'<span class="dtheme-icon">☀</span> Dark Mode':'<span class="dtheme-icon">☾</span> Light Mode',o.addEventListener("click",l=>{l.stopPropagation(),document.documentElement.dataset.theme==="light"?(delete document.documentElement.dataset.theme,localStorage.removeItem("searchle-theme"),o.innerHTML='<span class="dtheme-icon">☾</span> Light Mode'):(document.documentElement.dataset.theme="light",localStorage.setItem("searchle-theme","light"),o.innerHTML='<span class="dtheme-icon">☀</span> Dark Mode')}),document.body.appendChild(o),this._drawerThemeBtn=o}updateStats(e){this.winHistory=e||this.winHistory,!(!this.drawerContentEl||!this.mode)&&(this.mode==="sp"?this.drawerContentEl.innerHTML=this._renderSPStats(this.winHistory):this.drawerContentEl.innerHTML=this._renderMPStats(this.winHistory))}_renderSPStats(e){const t=e.length;if(t===0)return'<div class="stats-empty">No games completed yet</div>';const n=e.reduce((a,l)=>a+(l.guessCount||0),0),s=Math.round(n/t),r=Math.min(...e.map(a=>a.guessCount||1/0)),o=[...e].reverse().slice(0,5);return`
      <div class="stats-summary-row">
        <div class="stats-box">
          <div class="stats-box-value">${t}</div>
          <div class="stats-box-label">Won</div>
        </div>
        <div class="stats-box">
          <div class="stats-box-value">${s}</div>
          <div class="stats-box-label">Avg Guesses</div>
        </div>
        <div class="stats-box">
          <div class="stats-box-value">${r===1/0?"-":r}</div>
          <div class="stats-box-label">Best</div>
        </div>
      </div>
      <div class="stats-section-label">Recent Games</div>
      <div class="stats-recent-list">
        ${o.map(a=>`
          <div class="stats-recent-row">
            <span class="stats-recent-num">${a.wordNumber?"#"+a.wordNumber:""}</span>
            <span class="stats-recent-word">${(a.word||"").toUpperCase()}</span>
            <span class="stats-recent-guesses">${a.guessCount||"?"}g</span>
            <span class="stats-recent-time">${this._timeAgo(a.timestamp)}</span>
          </div>
        `).join("")}
      </div>
    `}_renderMPStats(e){const t=e.length;if(t===0)return'<div class="stats-empty">No games completed yet</div>';const n=e.reduce((d,f)=>d+(f.guessCount||0),0),s=Math.round(n/t),r=new Map,o=new Map,a=new Map;for(const d of e){const f=d.user?d.user.displayName||"Unknown":d.displayName||"Unknown",u=d.user&&d.user.platform||"",p=d.user&&d.user.linkedDiscord?d.user.linkedDiscord:f;r.set(p,(r.get(p)||0)+1),o.set(p,f),a.set(p,u)}const l=[...r.entries()].sort((d,f)=>f[1]-d[1]).slice(0,10),c=[...e].reverse().slice(0,5);return`
      <div class="stats-summary-row">
        <div class="stats-box">
          <div class="stats-box-value">${t}</div>
          <div class="stats-box-label">Games</div>
        </div>
        <div class="stats-box">
          <div class="stats-box-value">${s}</div>
          <div class="stats-box-label">Avg Guesses</div>
        </div>
        <div class="stats-box">
          <div class="stats-box-value">${l.length}</div>
          <div class="stats-box-label">Players</div>
        </div>
      </div>
      <div class="stats-section-label">Last 5 Games</div>
      <div class="stats-recent-list">
        ${c.map(d=>{const f=d.user?d.user.displayName||"?":d.displayName||"?",u=d.user&&d.user.platform||"";return`
            <div class="stats-recent-row">
              <span class="stats-recent-word">${(d.word||"").toUpperCase()}</span>
              <span class="stats-recent-winner">${this._platformDot(u)}${this._escHtml(f)}</span>
              <span class="stats-recent-guesses">${d.guessCount||"?"}g</span>
              <span class="stats-recent-time">${this._timeAgo(d.timestamp)}</span>
            </div>
          `}).join("")}
      </div>
      <div class="stats-section-label" style="margin-top:36px">Top 10 Players</div>
      <div class="stats-lb-list">
        ${l.map((d,f)=>{const u=a.get(d[0])||"";return`
            <div class="stats-lb-row">
              <span class="stats-lb-rank ${f===0?"gold":f===1?"silver":f===2?"bronze":""}">${f+1}.</span>
              <span class="stats-lb-name">${this._platformDot(u)}${this._escHtml(o.get(d[0])||d[0])}</span>
              <span class="stats-lb-wins">${d[1]}<span class="stats-lb-wins-label">w</span></span>
            </div>
          `}).join("")}
      </div>
    `}_platformDot(e){return e?'<span class="stats-plat-dot" style="background:'+({tiktok:"#69C9D0",youtube:"#FF0000",discord:"#5865F2"}[e]||"rgba(255,255,255,0.3)")+'"></span>':""}_escHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}_timeAgo(e){if(!e)return"";const t=Date.now()-new Date(e).getTime(),n=Math.floor(t/6e4);if(n<1)return"now";if(n<60)return n+"m";const s=Math.floor(n/60);return s<24?s+"h":Math.floor(s/24)+"d"}static _countUserWins(e,t,n){let s=0;for(const r of e){const o=r.user?r.user.platformUserId||r.user.id:r.userId,a=r.user?r.user.linkedDiscord:null;if(o===t){s++;continue}if(n&&a&&a===n){s++;continue}if(n&&o===n){s++;continue}if(a&&a===t){s++;continue}}return s}}class i_{constructor(e){this.domRenderer=e,this.startTime=null,this.guessCount=0,this.tickerInterval=null,this._currentDisplayed=3e3,this._visible=!0,this._frenzyMultiplier=1,this.element=this._buildElement(),this.object3D=e.makeObject(this.element),e.add(this.element),this.amountEl=this.element.querySelector(".jackpot-amount"),this.weeklyBadgeEl=this.element.querySelector(".weekly-badge"),this.frenzyBadgeEl=this.element.querySelector(".frenzy-badge")}_buildElement(){const e=document.createElement("div");return e.className="jackpot-bar",e.style.width=st.baseWidth+"px",e.innerHTML=`
      <span class="jackpot-label">XP</span>
      <span class="jackpot-amount">3,000</span>
      <span class="weekly-badge" style="display:none;">WEEKLY</span>
      <span class="frenzy-badge" style="display:none;"><span class="frenzy-label">FRENZY</span><span class="frenzy-value">1.0x</span></span>
    `,e}get height(){return this.element.offsetHeight||162}setPosition(e){const t=this.height/2;this.object3D.position.set(st.baseWidth/2,-(e+t),0)}start(e,t){this.startTime=e,this.guessCount=t,this.tickerInterval&&clearInterval(this.tickerInterval),this._updateAmount(),this.tickerInterval=setInterval(()=>this._updateAmount(),1e3)}stop(){this.tickerInterval&&(clearInterval(this.tickerInterval),this.tickerInterval=null)}addGuess(){this.guessCount++}bump(){this.element.classList.remove("bump"),this.element.offsetWidth,this.element.classList.add("bump"),setTimeout(()=>this.element.classList.remove("bump"),350)}_calculatePot(){if(!this.startTime)return 3e3;const e=(Date.now()-new Date(this.startTime).getTime())/1e3;let t;this.guessCount<=1e3?t=this.guessCount*10:t=1e4*Math.pow(this.guessCount/1e3,1.5);let n;return e<=600?n=e/600*1e4:n=1e4*Math.pow(e/600,1.5),Math.max(3e3,Math.round((t+n)*(this._frenzyMultiplier||1)))}_updateAmount(){const e=this._calculatePot();this.amountEl&&this._currentDisplayed!==e&&(this._currentDisplayed=e,this.amountEl.textContent=e.toLocaleString())}setSpecialBadge(e){this.weeklyBadgeEl&&(e?(this.weeklyBadgeEl.textContent=e.toUpperCase(),this.weeklyBadgeEl.style.display="inline-block"):this.weeklyBadgeEl.style.display="none")}setWeekly(e){this.setSpecialBadge(e?"WEEKLY":null)}setFrenzy(e){if(!this.frenzyBadgeEl)return;const t=e&&e.multiplier?e.multiplier:1;if(this._frenzyMultiplier=t,t>1){this.frenzyBadgeEl.style.display="inline-block";const n=this.frenzyBadgeEl.querySelector(".frenzy-value");n&&(n.textContent=t.toFixed(1)+"x")}else this.frenzyBadgeEl.style.display="none"}setVisible(e){!e&&this._visible&&this.stop(),this.element.style.display=e?"":"none",this._visible=e}get visible(){return this._visible!==!1}}class s_{constructor(e){this.domRenderer=e,this.hideTimer=null,this.element=this._buildElement(),this.object3D=e.makeObject(this.element),this.object3D.position.set(st.baseWidth/2,-630,30),this.object3D.visible=!1,e.add(this.element),this.wordEl=this.element.querySelector(".win-word"),this.userEl=this.element.querySelector(".win-user"),this.detailEl=this.element.querySelector(".win-detail"),this.picEl=this.element.querySelector(".win-pic"),this.picFbEl=this.element.querySelector(".win-pic-fallback"),this.contentEl=this.element.querySelector(".win-content")}_buildElement(){const e=document.createElement("div");return e.className="win-overlay",e.style.width=st.baseWidth+"px",e.innerHTML=`
      <div class="win-content">
        <div class="win-top-row">
          <h1>FOUND IT!</h1>
          <p class="win-word"></p>
        </div>
        <div class="win-profile">
          <img class="win-pic" src="" alt="">
          <div class="win-pic-fallback hidden"></div>
        </div>
        <div class="win-bottom-row">
          <p class="win-user"></p>
          <p class="win-detail"></p>
        </div>
      </div>
    `,e}show(e,t,n,s){this.hideTimer&&clearTimeout(this.hideTimer),this.wordEl.textContent=e,this.userEl.textContent="Found by "+t.displayName+"!";const r=[];n&&r.push(n.toLocaleString()+" XP"),r.push(s+" guess"+(s!==1?"es":"")),this.detailEl.textContent=r.join(" • ");for(const a of[this.picEl,this.picFbEl])a.style.border="",a.style.boxShadow="",a.style.animation="",delete a.dataset.borderShadow;this.userEl.style.color="",this.userEl.style.textShadow="",this.userEl.style.animation="",this.contentEl&&(this.contentEl.style.background="",this.contentEl.style.backgroundSize="",this.contentEl.style.animation="",this.contentEl.classList.remove("has-hero-badge")),t.profilePic?(this.picEl.src=t.profilePic,this.picEl.classList.remove("hidden"),this.picFbEl.classList.add("hidden"),this.picEl.onerror=()=>{this.picEl.classList.add("hidden"),this.picFbEl.classList.remove("hidden"),this.picFbEl.style.backgroundColor=si(t.platform),this.picFbEl.textContent=(t.displayName||"?")[0].toUpperCase(),t.cosmetics&&Un({avatarEl:this.picFbEl,avatarSize:504},t.cosmetics)}):(this.picEl.classList.add("hidden"),this.picFbEl.classList.remove("hidden"),this.picFbEl.style.backgroundColor=si(t.platform),this.picFbEl.textContent=(t.displayName||"?")[0].toUpperCase());const o=t.cosmetics?Object.keys(t.cosmetics):[];if(console.log("[WinOverlay] cosmetics:",o.length?o.join(", "):"(empty)",t.cosmetics),t.cosmetics&&o.length>0){const a=t.profilePic?this.picEl:this.picFbEl;Un({avatarEl:a,nameEl:this.userEl,surfaceEl:this.contentEl,avatarSize:504},t.cosmetics),t.cosmetics.hero_badge&&this.contentEl.classList.add("has-hero-badge")}this.object3D.visible=!0,this.element.classList.remove("hidden"),this._spawnMoneyRain(),this.hideTimer=setTimeout(()=>this.hide(),st.winDisplayDuration)}hide(){this.object3D.visible=!1,this.element.classList.add("hidden")}_spawnMoneyRain(){const e=["💵","💰","🪙","💲","💸"],s={width:st.baseWidth};for(let r=0;r<30;r++){const o=Math.random()*1200;setTimeout(()=>{const a=document.createElement("div");a.className="money-particle",a.textContent=e[Math.floor(Math.random()*e.length)],a.style.left=Math.round(Math.random()*s.width)+"px",a.style.top="-180px",a.style.fontSize=90+Math.random()*90+"px";const l=(2800-o)/1e3;a.style.animationDuration=Math.max(1,l)+"s",a.style.animationDelay="0s",document.body.appendChild(a),setTimeout(()=>{a.parentNode&&a.parentNode.removeChild(a)},l*1e3+200)},o)}}}class r_{constructor(){this._injectStyles(),this._createOverlay(),this.hideTimer=null}init(e){e.on("coin-reward",t=>this.show(t))}_injectStyles(){const e=document.createElement("style");e.textContent=`
      .coin-reward-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .coin-reward-overlay.visible { opacity: 1; }

      .coin-reward-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }

      .coin-reward-label {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 18px;
        font-weight: 700;
        color: #fff;
        text-shadow: 0 2px 8px rgba(0,0,0,0.7);
        opacity: 0;
        transform: translateY(10px);
        animation: crLabelIn 0.5s 0.1s ease forwards;
      }

      .coin-reward-amount {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 52px;
        font-weight: 900;
        color: #39ff14;
        text-shadow: 0 0 20px rgba(57, 255, 20, 0.6), 0 4px 12px rgba(0,0,0,0.8);
        opacity: 0;
        transform: scale(0.3);
        animation: crAmountPop 0.6s 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      .coin-reward-balance-row {
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transform: translateY(20px);
        animation: crBalanceIn 0.5s 1.6s ease forwards;
      }

      .coin-reward-balance-label {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: rgba(255,255,255,0.7);
        text-shadow: 0 1px 4px rgba(0,0,0,0.5);
      }

      .coin-reward-balance {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 28px;
        font-weight: 800;
        color: #fff;
        text-shadow: 0 0 12px rgba(57,255,20,0.3), 0 2px 6px rgba(0,0,0,0.6);
      }

      .coin-particle {
        position: fixed;
        font-size: 24px;
        pointer-events: none;
        z-index: 100000;
        opacity: 0;
      }

      @keyframes crCoinFloat {
        0% { opacity: 1; transform: scale(1) translate(var(--cx), var(--cy)); }
        60% { opacity: 1; transform: scale(1.2) translate(var(--cx), var(--cy)) rotate(180deg); }
        100% { opacity: 0; transform: scale(0.3) translate(var(--tx), var(--ty)) rotate(360deg); }
      }

      @keyframes crLabelIn { to { opacity: 1; transform: translateY(0); } }
      @keyframes crAmountPop { to { opacity: 1; transform: scale(1); } }
      @keyframes crBalanceIn { to { opacity: 1; transform: translateY(0); } }
      @keyframes crBalancePulse {
        0% { transform: scale(1); color: #fff; }
        50% { transform: scale(1.15); color: #39ff14; }
        100% { transform: scale(1); color: #fff; }
      }
      .coin-reward-balance.pulse { animation: crBalancePulse 0.4s ease; }
    `,document.head.appendChild(e)}_createOverlay(){this.overlay=document.createElement("div"),this.overlay.className="coin-reward-overlay",this.overlay.innerHTML=`
      <div class="coin-reward-box">
        <div class="coin-reward-label"></div>
        <div class="coin-reward-amount"></div>
        <div class="coin-reward-balance-row">
          <span class="coin-reward-balance-label">New Balance:</span>
          <span class="coin-reward-balance"></span>
        </div>
      </div>
    `,document.body.appendChild(this.overlay),this.labelEl=this.overlay.querySelector(".coin-reward-label"),this.amountEl=this.overlay.querySelector(".coin-reward-amount"),this.balanceRowEl=this.overlay.querySelector(".coin-reward-balance-row"),this.balanceEl=this.overlay.querySelector(".coin-reward-balance")}_formatNumber(e){return e>=1e9?(e/1e9).toFixed(1)+"B":e>=1e6?(e/1e6).toFixed(1)+"M":e>=1e3?(e/1e3).toFixed(1)+"K":e.toLocaleString()}show(e){const{player:t,coinsAwarded:n,newBalance:s}=e;if(n){if(this.hideTimer&&clearTimeout(this.hideTimer),this.labelEl.textContent=t||"Player",this.labelEl.style.animation="none",this.amountEl.textContent="+"+this._formatNumber(n)+" XP",this.amountEl.style.animation="none",this.balanceRowEl.style.animation="none",this.balanceEl.classList.remove("pulse"),this.labelEl.offsetWidth,this.labelEl.style.animation="",this.amountEl.style.animation="",this.balanceRowEl.style.animation="",s&&s>0){this.balanceRowEl.style.display="flex";const r=Math.max(0,s-n);this.balanceEl.textContent=this._formatNumber(r),setTimeout(()=>this._countUp(r,s,600),2e3)}else this.balanceRowEl.style.display="none";this.overlay.classList.add("visible"),this.hideTimer=setTimeout(()=>this.overlay.classList.remove("visible"),4e3)}}_countUp(e,t,n){const s=performance.now(),r=t-e,o=a=>{const l=Math.min((a-s)/n,1),c=1-Math.pow(1-l,3);this.balanceEl.textContent=this._formatNumber(Math.round(e+r*c)),l<1?requestAnimationFrame(o):(this.balanceEl.textContent=this._formatNumber(t),this.balanceEl.classList.add("pulse"))};requestAnimationFrame(o)}}function mn(i,e){return Math.random()*(e-i)+i}function Pl(i){return i[Math.floor(Math.random()*i.length)]}function Ll(i,e,t){return{x:mn(0,e),y:mn(-t*.3,-20),vx:mn(-3,3),vy:mn(2,6),size:mn(6,12),rotation:mn(0,360),rotSpeed:mn(-8,8),color:Pl(i),shape:Pl(["rect","circle"]),gravity:.08,drag:.99,wobble:mn(0,Math.PI*2),wobbleSpeed:mn(.02,.06),opacity:1}}const o_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||80);s++)n.push(Ll(i.colors,e,t));return n},update(i,e,t,n,s,r,o){if(t<n*.7&&i.length<120){const a=Math.max(1,Math.floor((o.particleCount||80)/30));for(let l=0;l<a;l++)i.push(Ll(o.colors,s,r))}for(let a=i.length-1;a>=0;a--){const l=i[a];l.wobble+=l.wobbleSpeed,l.vx+=Math.sin(l.wobble)*.1,l.vy+=l.gravity,l.vx*=l.drag,l.x+=l.vx,l.y+=l.vy,l.rotation+=l.rotSpeed,t>n*.7&&(l.opacity=Math.max(0,l.opacity-.015)),(l.y>r+30||l.opacity<=0)&&i.splice(a,1)}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];e.save(),e.translate(s.x,s.y),e.rotate(s.rotation*Math.PI/180),e.globalAlpha=s.opacity,e.fillStyle=s.color,s.shape==="rect"?e.fillRect(-s.size/2,-s.size/4,s.size,s.size/2):(e.beginPath(),e.arc(0,0,s.size/2,0,Math.PI*2),e.fill()),e.restore()}}};function $n(i,e){return Math.random()*(e-i)+i}function a_(i){return i[Math.floor(Math.random()*i.length)]}function l_(i,e,t,n,s,r){i.save(),i.globalAlpha=r,i.fillStyle=s,i.beginPath();for(let o=0;o<4;o++){const a=o/4*Math.PI*2-Math.PI/2;i.moveTo(e,t),i.lineTo(e+Math.cos(a)*n,t+Math.sin(a)*n),i.lineTo(e+Math.cos(a+.3)*n*.3,t+Math.sin(a+.3)*n*.3)}i.fill(),i.restore()}function Dl(i,e,t){const n=e/2,s=t/2,r=$n(0,Math.PI*2),o=$n(2,8);return{x:n+$n(-100,100),y:s+$n(-100,100),vx:Math.cos(r)*o,vy:Math.sin(r)*o,size:$n(2,5),color:a_(i),life:1,decay:$n(.008,.02),twinkle:$n(0,Math.PI*2),gravity:.02}}const c_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||40);s++)n.push(Dl(i.colors,e,t));return n},update(i,e,t,n,s,r,o){if(t<n*.75&&i.length<60)for(let a=0;a<2;a++)i.push(Dl(o.colors,s,r));for(let a=i.length-1;a>=0;a--){const l=i[a];l.vy+=l.gravity,l.x+=l.vx,l.y+=l.vy,l.twinkle+=.15,l.life-=l.decay,l.life<=0&&i.splice(a,1)}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n],r=s.life*(.5+.5*Math.sin(s.twinkle));l_(e,s.x,s.y,s.size*2,s.color,r)}}};function Pn(i,e){return Math.random()*(e-i)+i}function h_(i){return i[Math.floor(Math.random()*i.length)]}function u_(i,e,t,n,s,r,o){i.save(),i.translate(e,t),i.rotate(o*Math.PI/180),i.globalAlpha=r,i.fillStyle=s,i.beginPath();const a=n/2;i.moveTo(0,a*.4),i.bezierCurveTo(-a,-a*.4,-a*1.4,a*.4,0,a*1.2),i.bezierCurveTo(a*1.4,a*.4,a,-a*.4,0,a*.4),i.fill(),i.restore()}function Il(i,e,t){return{x:Pn(0,e),y:t+Pn(10,60),vx:Pn(-1,1),vy:Pn(-4,-2),size:Pn(10,22),color:h_(i),rotation:Pn(-20,20),wobble:Pn(0,Math.PI*2),wobbleSpeed:Pn(.02,.05),opacity:1,fadeStart:.7}}const d_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||30);s++)n.push(Il(i.colors,e,t));return n},update(i,e,t,n,s,r,o){t<n*.65&&i.length<40&&i.push(Il(o.colors,s,r));for(let a=i.length-1;a>=0;a--){const l=i[a];l.wobble+=l.wobbleSpeed,l.x+=l.vx+Math.sin(l.wobble)*.5,l.y+=l.vy,l.rotation+=Math.sin(l.wobble)*.5;const c=t/n;c>l.fadeStart&&(l.opacity=Math.max(0,1-(c-l.fadeStart)/(1-l.fadeStart))),(l.y<-40||l.opacity<=0)&&i.splice(a,1)}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];u_(e,s.x,s.y,s.size,s.color,s.opacity,s.rotation)}}};function ri(i,e){return Math.random()*(e-i)+i}function f_(i){return i[Math.floor(Math.random()*i.length)]}function Ul(i,e,t){const n=ri(e*.2,e*.8),s=ri(t*.1,t*.4);return{type:"shell",x:n,y:t+10,targetY:s,vy:ri(-12,-8),color:f_(i),exploded:!1,trail:[]}}function p_(i,e,t){const n=ri(0,Math.PI*2),s=ri(1,7);return{type:"spark",x:i,y:e,vx:Math.cos(n)*s,vy:Math.sin(n)*s,color:t,size:ri(2,4),life:1,decay:ri(.015,.03),gravity:.06}}let Kr=0;const m_={init(i,e,t){const n=[],s=Math.min(i.particleCount||60,8);for(let r=0;r<s;r++){const o=Ul(i.colors,e,t);o.delay=r*400,o.born=Date.now(),n.push(o)}return Kr=Date.now(),n},update(i,e,t,n,s,r,o){const a=Date.now();if(t<n*.7&&a-Kr>600){const l=Ul(o.colors,s,r);l.delay=0,l.born=a,i.push(l),Kr=a}for(let l=i.length-1;l>=0;l--){const c=i[l];if(c.type==="shell"){if(a-c.born<(c.delay||0))continue;if(c.y+=c.vy,c.vy+=.15,c.trail.push({x:c.x,y:c.y}),c.trail.length>8&&c.trail.shift(),c.y<=c.targetY||c.vy>=0){for(let d=0;d<30;d++)i.push(p_(c.x,c.y,c.color));i.splice(l,1)}}else c.type==="spark"&&(c.vy+=c.gravity,c.x+=c.vx,c.y+=c.vy,c.vx*=.98,c.life-=c.decay,c.life<=0&&i.splice(l,1))}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];if(s.type==="shell"){for(let r=0;r<s.trail.length;r++)e.globalAlpha=r/s.trail.length*.6,e.fillStyle=s.color,e.beginPath(),e.arc(s.trail[r].x,s.trail[r].y,2,0,Math.PI*2),e.fill();e.globalAlpha=1,e.fillStyle="#fff",e.beginPath(),e.arc(s.x,s.y,3,0,Math.PI*2),e.fill()}else s.type==="spark"&&(e.globalAlpha=s.life,e.shadowColor=s.color,e.shadowBlur=6,e.fillStyle=s.color,e.beginPath(),e.arc(s.x,s.y,s.size*s.life,0,Math.PI*2),e.fill(),e.shadowBlur=0)}e.globalAlpha=1}};function Ti(i,e){return Math.random()*(e-i)+i}function Nl(i,e){let t=Ti(i*.1,i*.9);const n=[{x:t,y:0}];let s=0;for(;s<e;)s+=Ti(20,60),t+=Ti(-40,40),n.push({x:t,y:Math.min(s,e)});return{points:n,opacity:1,width:Ti(2,5),glow:Ti(15,30),delay:Ti(0,1500),born:Date.now()}}const g_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||8);s++)n.push(Nl(e,t));return n},update(i,e,t,n,s,r,o){const a=Date.now();if(t<n*.8&&i.length<4){const l=Nl(s,r);l.delay=0,l.born=a,i.push(l)}for(let l=i.length-1;l>=0;l--){const c=i[l],d=a-c.born;if(d<c.delay)continue;const f=d-c.delay;f<100?c.opacity=1:f<200?c.opacity=.3:f<300?c.opacity=.8:c.opacity=Math.max(0,1-(f-300)/400),c.opacity<=0&&i.splice(l,1)}},draw(i,e,t){const n=Date.now();for(let s=0;s<i.length;s++){const r=i[s];if(!(n-r.born<r.delay)){e.save(),e.globalAlpha=r.opacity,e.strokeStyle="#fff",e.lineWidth=r.width,e.shadowColor="#a5f3fc",e.shadowBlur=r.glow,e.beginPath(),e.moveTo(r.points[0].x,r.points[0].y);for(let o=1;o<r.points.length;o++)e.lineTo(r.points[o].x,r.points[o].y);e.stroke(),e.lineWidth=Math.max(1,r.width-2),e.shadowBlur=r.glow*2,e.stroke(),e.restore()}}}};function Wt(i,e){return Math.random()*(e-i)+i}function __(i){return i[Math.floor(Math.random()*i.length)]}function Fl(i,e){return{x:Wt(-20,e+20),y:Wt(-40,-10),vx:Wt(-.5,.5),vy:Wt(1,3),size:Wt(3,8),color:__(i),wobble:Wt(0,Math.PI*2),wobbleSpeed:Wt(.01,.04),wobbleAmp:Wt(.3,1),opacity:Wt(.5,1),rotation:Wt(0,360),rotSpeed:Wt(-2,2)}}const v_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||60);s++){const r=Fl(i.colors,e);r.y=Wt(-t,-10),n.push(r)}return n},update(i,e,t,n,s,r,o){t<n*.7&&i.length<80&&i.push(Fl(o.colors,s));for(let a=i.length-1;a>=0;a--){const l=i[a];l.wobble+=l.wobbleSpeed,l.x+=l.vx+Math.sin(l.wobble)*l.wobbleAmp,l.y+=l.vy,l.rotation+=l.rotSpeed,t>n*.75&&(l.opacity=Math.max(0,l.opacity-.01)),(l.y>r+20||l.opacity<=0)&&i.splice(a,1)}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];e.save(),e.translate(s.x,s.y),e.rotate(s.rotation*Math.PI/180),e.globalAlpha=s.opacity,e.fillStyle=s.color,e.shadowColor=s.color,e.shadowBlur=4;for(let r=0;r<6;r++){const o=r/6*Math.PI*2;e.fillRect(-.5,0,1,s.size),e.save(),e.rotate(o),e.fillRect(-.5,0,1,s.size),e.restore()}e.restore()}}};function jn(i,e){return Math.random()*(e-i)+i}function y_(i){return i[Math.floor(Math.random()*i.length)]}function Ol(i,e,t){const n=jn(-50,e+50),s=jn(.3,.8);return{x:n,y:-20,vx:Math.cos(s)*jn(6,14),vy:Math.sin(s)*jn(6,14),size:jn(3,6),color:y_(i),tailLen:jn(30,80),trail:[],life:1,decay:jn(.005,.012)}}let Zr=0;const x_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||12);s++){const r=Ol(i.colors,e);r.delay=s*200,r.born=Date.now(),n.push(r)}return Zr=Date.now(),n},update(i,e,t,n,s,r,o){const a=Date.now();if(t<n*.7&&a-Zr>300&&i.length<20){const l=Ol(o.colors,s);l.delay=0,l.born=a,i.push(l),Zr=a}for(let l=i.length-1;l>=0;l--){const c=i[l];a-c.born<(c.delay||0)||(c.trail.push({x:c.x,y:c.y}),c.trail.length>15&&c.trail.shift(),c.x+=c.vx,c.y+=c.vy,c.life-=c.decay,(c.life<=0||c.y>r+30||c.x>s+50)&&i.splice(l,1))}},draw(i,e,t){const n=Date.now();for(let s=0;s<i.length;s++){const r=i[s];if(!(n-r.born<(r.delay||0))){for(let o=0;o<r.trail.length;o++){const a=o/r.trail.length*r.life*.6,l=r.size*(o/r.trail.length);e.globalAlpha=a,e.fillStyle=r.color,e.beginPath(),e.arc(r.trail[o].x,r.trail[o].y,l,0,Math.PI*2),e.fill()}e.globalAlpha=r.life,e.fillStyle="#fff",e.shadowColor=r.color,e.shadowBlur=10,e.beginPath(),e.arc(r.x,r.y,r.size,0,Math.PI*2),e.fill(),e.shadowBlur=0}}e.globalAlpha=1}};function Xt(i,e){return Math.random()*(e-i)+i}function S_(i){return i[Math.floor(Math.random()*i.length)]}function E_(i,e,t,n,s,r,o){i.save(),i.translate(e,t),i.rotate(o*Math.PI/180),i.globalAlpha=r,i.fillStyle=s,i.beginPath(),i.ellipse(0,0,n*.4,n,0,0,Math.PI*2),i.fill(),i.restore()}function Bl(i,e){return{x:Xt(-20,e+20),y:Xt(-40,-10),vx:Xt(-1.5,1.5),vy:Xt(1,2.5),size:Xt(6,14),color:S_(i),rotation:Xt(0,360),rotSpeed:Xt(-3,3),wobble:Xt(0,Math.PI*2),wobbleSpeed:Xt(.02,.05),wobbleAmp:Xt(.5,1.5),opacity:Xt(.6,1)}}const M_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||50);s++){const r=Bl(i.colors,e);r.y=Xt(-t*.5,-10),n.push(r)}return n},update(i,e,t,n,s,r,o){t<n*.65&&i.length<60&&i.push(Bl(o.colors,s));for(let a=i.length-1;a>=0;a--){const l=i[a];l.wobble+=l.wobbleSpeed,l.x+=l.vx+Math.sin(l.wobble)*l.wobbleAmp,l.y+=l.vy,l.rotation+=l.rotSpeed,t>n*.7&&(l.opacity=Math.max(0,l.opacity-.01)),(l.y>r+30||l.opacity<=0)&&i.splice(a,1)}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];E_(e,s.x,s.y,s.size,s.color,s.opacity,s.rotation)}}};function Ai(i,e){return Math.random()*(e-i)+i}function b_(i){return i[Math.floor(Math.random()*i.length)]}function w_(i,e,t,n){return{color:b_(i),y:t*Ai(.15,.6),amplitude:Ai(30,80),frequency:Ai(.003,.008),speed:Ai(.5,1.5),phase:n*1.2,opacity:Ai(.15,.35),height:Ai(60,140),w:e}}const T_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||6);s++)n.push(w_(i.colors,e,t,s));return n},update(i,e,t,n,s,r,o){for(let a=0;a<i.length;a++)i[a].phase+=i[a].speed*.01,t>n*.6&&(i[a].opacity=Math.max(0,i[a].opacity-.003));for(let a=i.length-1;a>=0;a--)i[a].opacity<=0&&i.splice(a,1)},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];e.save(),e.globalAlpha=s.opacity;const r=e.createLinearGradient(0,s.y-s.height/2,0,s.y+s.height/2);r.addColorStop(0,"transparent"),r.addColorStop(.5,s.color),r.addColorStop(1,"transparent"),e.fillStyle=r,e.shadowColor=s.color,e.shadowBlur=30,e.beginPath(),e.moveTo(0,s.y);for(let o=0;o<=s.w;o+=4){const a=Math.sin(o*s.frequency+s.phase)*s.amplitude;e.lineTo(o,s.y+a)}e.lineTo(s.w,s.y+s.height),e.lineTo(0,s.y+s.height),e.closePath(),e.fill(),e.restore()}}};function Ci(i,e){return Math.random()*(e-i)+i}function A_(i){return i[Math.floor(Math.random()*i.length)]}function kl(i,e,t){const n=e/2,s=t/2,r=Ci(0,Math.PI*2),o=Ci(5,200);return{x:n+Math.cos(r)*o,y:s+Math.sin(r)*o,angle:r,dist:o,speed:Ci(.01,.04),size:Ci(1,4),color:A_(i),vr:Ci(.5,2),life:1,decay:Ci(.002,.008),cx:n,cy:s}}const C_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||100);s++)n.push(kl(i.colors,e,t));return n},update(i,e,t,n,s,r,o){if(t<n*.6&&i.length<120)for(let a=0;a<3;a++)i.push(kl(o.colors,s,r));for(let a=i.length-1;a>=0;a--){const l=i[a];l.angle+=l.speed,l.dist+=l.vr,l.x=l.cx+Math.cos(l.angle)*l.dist,l.y=l.cy+Math.sin(l.angle)*l.dist,l.life-=l.decay,l.life<=0&&i.splice(a,1)}},draw(i,e,t){for(let n=0;n<i.length;n++){const s=i[n];e.globalAlpha=s.life,e.fillStyle=s.color,e.shadowColor=s.color,e.shadowBlur=4,e.beginPath(),e.arc(s.x,s.y,s.size,0,Math.PI*2),e.fill()}e.globalAlpha=1,e.shadowBlur=0}};function Jn(i,e){return Math.random()*(e-i)+i}function R_(i){return i[Math.floor(Math.random()*i.length)]}function zl(i,e,t){return{x:e/2+Jn(-30,30),y:t+Jn(0,20),vx:Jn(-2,2),vy:Jn(-8,-3),size:Jn(3,8),color:R_(i),life:1,decay:Jn(.008,.02),gravity:-.05,trail:[]}}const P_={init(i,e,t){const n=[];for(let s=0;s<(i.particleCount||80);s++){const r=zl(i.colors,e,t);r.delay=Jn(0,1500),r.born=Date.now(),n.push(r)}return n},update(i,e,t,n,s,r,o){const a=Date.now();if(t<n*.7&&i.length<100){const l=zl(o.colors,s,r);l.delay=0,l.born=a,i.push(l)}for(let l=i.length-1;l>=0;l--){const c=i[l];a-c.born<c.delay||(c.trail.push({x:c.x,y:c.y}),c.trail.length>10&&c.trail.shift(),c.vy+=c.gravity,c.x+=c.vx,c.y+=c.vy,c.vx*=.99,c.life-=c.decay,c.life<=0&&i.splice(l,1))}},draw(i,e,t){const n=Date.now();for(let s=0;s<i.length;s++){const r=i[s];if(!(n-r.born<r.delay)){for(let o=0;o<r.trail.length;o++)e.globalAlpha=o/r.trail.length*r.life*.5,e.fillStyle=r.color,e.beginPath(),e.arc(r.trail[o].x,r.trail[o].y,r.size*(o/r.trail.length),0,Math.PI*2),e.fill();e.globalAlpha=r.life,e.fillStyle="#fff",e.shadowColor=r.color,e.shadowBlur=12,e.beginPath(),e.arc(r.x,r.y,r.size*.7,0,Math.PI*2),e.fill(),e.shadowBlur=0}}e.globalAlpha=1}};function as(i,e){return Math.random()*(e-i)+i}function L_(i){return i[Math.floor(Math.random()*i.length)]}function D_(i,e,t){const n=e/2,s=t/2,r=as(0,Math.PI*2),o=as(3,15);return{x:n,y:s,vx:Math.cos(r)*o,vy:Math.sin(r)*o,size:as(2,6),color:L_(i),life:1,decay:as(.005,.015),gravity:.04}}const I_={init(i,e,t){const n=[];n.push({type:"ring",cx:e/2,cy:t/2,radius:0,maxRadius:Math.max(e,t),speed:14,opacity:1,width:10}),n.push({type:"ring",cx:e/2,cy:t/2,radius:0,maxRadius:Math.max(e,t),speed:10,opacity:.7,width:6,delay:200,born:Date.now()}),n.push({type:"flash",opacity:1});for(let s=0;s<(i.particleCount||150);s++){const r=D_(i.colors,e,t);r.type="particle",r.delay=as(0,500),r.born=Date.now(),n.push(r)}return n},update(i,e,t,n,s,r,o){const a=Date.now();for(let l=i.length-1;l>=0;l--){const c=i[l];if(c.type==="flash")c.opacity=Math.max(0,1-t/600),c.opacity<=0&&i.splice(l,1);else if(c.type==="ring"){if(c.delay&&a-c.born<c.delay)continue;c.radius+=c.speed,c.opacity=Math.max(0,1-c.radius/c.maxRadius),c.opacity<=0&&i.splice(l,1)}else if(c.type==="particle"){if(a-c.born<(c.delay||0))continue;c.vy+=c.gravity,c.x+=c.vx,c.y+=c.vy,c.vx*=.98,c.life-=c.decay,c.life<=0&&i.splice(l,1)}}},draw(i,e,t){const n=Date.now();for(let s=0;s<i.length;s++){const r=i[s];if(r.type==="flash")e.save(),e.globalAlpha=r.opacity*.7,e.fillStyle="#ffffff",e.fillRect(0,0,t.width,t.height),e.restore();else if(r.type==="ring"){if(r.delay&&n-r.born<r.delay)continue;e.save(),e.globalAlpha=r.opacity,e.strokeStyle="#ffffff",e.lineWidth=r.width*r.opacity,e.shadowColor="#ffff00",e.shadowBlur=20,e.beginPath(),e.arc(r.cx,r.cy,r.radius,0,Math.PI*2),e.stroke(),e.restore()}else if(r.type==="particle"){if(n-r.born<(r.delay||0))continue;e.globalAlpha=r.life,e.fillStyle=r.color,e.shadowColor=r.color,e.shadowBlur=6,e.beginPath(),e.arc(r.x,r.y,r.size*r.life,0,Math.PI*2),e.fill()}}e.globalAlpha=1,e.shadowBlur=0}},U_={confetti:o_,sparkles:c_,hearts:d_,fireworks:m_,lightning:g_,snowfall:v_,meteors:x_,cherry_blossom:M_,aurora:T_,galaxy_burst:C_,phoenix:P_,nuclear:I_};class N_{constructor(e){this.viewport=e,this.canvas=null,this.ctx=null,this.particles=null,this.animFrame=null,this.startTime=0,this.duration=0,this.effectConfig=null,this.currentEffect=null}playWinEffect(e){if(!e||!e.effect)return;const t=U_[e.effect];if(!t)return;this._cleanup(),this._createCanvas();const n=this.canvas.width,s=this.canvas.height;this.effectConfig=e,this.duration=e.duration||3e3,this.startTime=Date.now(),this.currentEffect=t,this.particles=t.init(e,n,s),this.animFrame=requestAnimationFrame(()=>this._animate()),setTimeout(()=>this._cleanup(),this.duration+1e3)}_createCanvas(){this.canvas=document.createElement("canvas"),this.canvas.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;";const e=Li||Tt?.5:1;this.canvas.width=Math.round(this.viewport.width*e),this.canvas.height=Math.round(this.viewport.height*e),document.body.appendChild(this.canvas),this.ctx=this.canvas.getContext("2d")}_cleanup(){this.animFrame&&cancelAnimationFrame(this.animFrame),this.animFrame=null,this.canvas&&this.canvas.parentNode&&this.canvas.parentNode.removeChild(this.canvas),this.canvas=null,this.ctx=null,this.particles=null,this.currentEffect=null}_animate(){if(!this.canvas||!this.ctx||!this.particles)return;const e=Date.now()-this.startTime;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height),this.currentEffect&&(this.currentEffect.update(this.particles,16,e,this.duration,this.canvas.width,this.canvas.height,this.effectConfig),this.currentEffect.draw(this.particles,this.ctx,this.canvas)),e<this.duration?this.animFrame=requestAnimationFrame(()=>this._animate()):this._cleanup()}get hasActiveEffect(){return this.canvas!==null}}const F_=new Set(["barracks","bellows","binoculars","boxers","briefs","chaps","clothes","corps","credentials","customs","dregs","dungarees","forceps","gallows","glasses","goggles","goods","headquarters","jeans","knickers","leggings","manners","narrows","overalls","pajamas","pants","pliers","premises","proceeds","remains","scissors","shears","shorts","slacks","suds","surroundings","suspenders","tights","tongs","trousers","tweezers","underpants","measles","molasses","mumps","news","shingles","series","species","atlas","chaos","cosmos","diabetes","ethos","herpes","kudos","lens","pathos","thermos","grits","nachos","oats","athletics","diagnostics","dynamics","economics","electronics","ethics","genetics","gymnastics","linguistics","logistics","mathematics","mechanics","physics","politics","statistics","tactics","therapeutics","across","always","besides","does","furthermore","goes","nonetheless","overseas","perhaps","sometimes","themselves","thus","upstairs","downstairs","towards","whereas","crossroads"]),Hl={grey:"gray",tyre:"tire",tyres:"tires",aluminium:"aluminum",jewellery:"jewelry",kerb:"curb",draught:"draft",plough:"plow",gaol:"jail",storey:"story",maths:"math",orientate:"orient",whilst:"while",amongst:"among",towards:"toward",afterwards:"afterward",forwards:"forward",backwards:"backward",upwards:"upward",downwards:"downward",outwards:"outward",inwards:"inward",cosy:"cozy",cheque:"check",catalogue:"catalog",dialogue:"dialog",prologue:"prolog",analogue:"analog",monologue:"monolog",epilogue:"epilog",skilful:"skillful",wilful:"willful",fulfilment:"fulfillment",enrolment:"enrollment",instalment:"installment",fulfil:"fulfill",enrol:"enroll",distil:"distill",enthral:"enthrall",appal:"appall",licence:"license",practise:"practice",pretence:"pretense",offence:"offense",defence:"defense",metre:"meter",litre:"liter",centre:"center",fibre:"fiber",lustre:"luster",theatre:"theater",sabre:"saber",sombre:"somber",spectre:"specter",calibre:"caliber",manoeuvre:"maneuver",oestrogen:"estrogen",paediatric:"pediatric",anaemia:"anemia",anaesthetic:"anesthetic",foetus:"fetus",diarrhoea:"diarrhea",haemorrhage:"hemorrhage",leukaemia:"leukemia",oesophagus:"esophagus",encyclopaedia:"encyclopedia",mediaeval:"medieval",aeroplane:"airplane",sulphur:"sulfur",pyjamas:"pajamas",sceptic:"skeptic",moustache:"mustache",artefact:"artifact",behove:"behoove",connexion:"connection"},O_=new Set(["four","pour","your","tour","dour","sour","hour","contour","detour","velour","glamour","flour","scour","devour","amour","tambour","troubadour"]),B_=new Set(["advise","comprise","compromise","supervise","surprise","exercise","improvise","revise","devise","demise","franchise","merchandise","enterprise","disguise","surmise","excise","incise","circumcise","concise","precise","premise","promise","otherwise","likewise","clockwise","paradise","arise","praise","raise","cruise","bruise","poise","noise","guise","reprise","wise"]),k_=new Set(["dwelling","spelling","smelling","yelling","telling","selling","compelling","propelling","repelling","quelling","swelling","shelling","excelling","felling","belling","welling","knelling"]);function Vl(i,e){let t=null,n=1/0;for(const s of i){const r=e[s];r!==void 0&&r<n&&(n=r,t=s)}return t}function z_(i,e){if(i.length<4||F_.has(i))return i;if(i.endsWith("ies")&&i.length>=5){const t=i.slice(0,-3)+"y";if(t in e)return t}if(i.endsWith("ves")&&i.length>=5){const t=[],n=i.slice(0,-3)+"f",s=i.slice(0,-3)+"fe",r=i.slice(0,-1);if(n in e&&t.push(n),s in e&&t.push(s),r in e&&t.push(r),t.length>0)return Vl(t,e)}if(i.endsWith("es")&&i.length>=5){const t=[],n=i.slice(0,-1),s=i.slice(0,-2);if(n in e&&t.push(n),s in e&&t.push(s),t.length>0)return Vl(t,e)}if(i.endsWith("s")&&!i.endsWith("ss")&&!i.endsWith("us")&&!i.endsWith("is")){const t=i.slice(0,-1);if(t in e)return t}return i}function H_(i,e){if(Hl[i]){const t=Hl[i];if(t in e)return t}if(i.endsWith("our")&&i.length>=5&&!O_.has(i)){const t=i.slice(0,-3)+"or";if(t in e)return t}if(i.endsWith("isation")){const t=i.slice(0,-7)+"ization";if(t in e)return t}if(i.endsWith("ise")&&i.length>=5&&!B_.has(i)){const t=i.slice(0,-3)+"ize";if(t in e)return t}if(i.endsWith("yse")){const t=i.slice(0,-3)+"yze";if(t in e)return t}if((i.endsWith("elling")||i.endsWith("elled"))&&!k_.has(i)){const t=i.replace(/ll(ing|ed)$/,"l$1");if(t in e)return t}return i}const V_=1,G_=/^[a-z]+$/;function W_(i,e,t,n){const s=i.trim().toLowerCase();if(!s||s.includes(" ")||s.includes("	"))return null;const r=s.replace(/[^a-z]/g,"");if(!r||!G_.test(r))return null;const o=H_(z_(r,e),e);if(t.has(o))return{word:o,rank:null,isWin:!1,isDuplicate:!0};let a;return o in e?a=e[o]:n&&n.has(o)?a=100001:a=9999999,{word:o,rank:a,isWin:a===V_,isDuplicate:!1}}class X_{constructor(e){this.socket=e;const t=location.pathname.replace(/[^/]*$/,"");this._poolBase=t+"sp-pool/",this.rankings=null,this.vocabSet=null,this.targetWord=null,this.totalRankedWords=0,this.wordNumber=null,this.weeklyNumber=null,this.isWeekly=!1,this.guesses=[],this.guessedWords=new Set,this.isWon=!1,this.startTime=null,this.winHistory=[],this.isLoading=!0,this._preloadedFile=null,this._preloadedText=null,this._preloadedParsed=null,this.onGameReady=null,this.onGuessResult=null,this.onWin=null,this.onDuplicateGuess=null,this.onLoading=null,this.onWeeklyCompleted=null,this.onPoolList=null,this._userId=this._readUserId(),this._userCosmetics=null,this._loadVocab(),this._setupSocketEvents()}_readUserId(){try{const e=JSON.parse(localStorage.getItem("searchle_user"));return e&&e.id?e.id:null}catch{return null}}setCosmetics(e){this._userCosmetics=e}async _loadVocab(){try{const e=performance.now(),t=await fetch(this._poolBase+"vocab.txt");if(!t.ok)throw new Error(`HTTP ${t.status}`);const n=await t.text();this.vocabSet=new Set(n.split(`
`)),console.log(`[SP] Vocab loaded: ${this.vocabSet.size.toLocaleString()} words in ${(performance.now()-e).toFixed(0)}ms`)}catch(e){console.warn("[SP] Failed to load vocab file:",e.message),this.vocabSet=null}}_setupSocketEvents(){this.socket.on("sp-init",e=>{if(this.winHistory=e.winHistory||[],e.weeklyCompleted){console.log("[SP] Weekly already completed — no game to load"),this.isLoading=!1,this.onLoading&&this.onLoading(!1),this.onWeeklyCompleted&&this.onWeeklyCompleted();return}const t=this._loadSavedGame();t&&!(e.isWeekly&&!t.isWeekly)?(console.log(`[SP] Found saved game: ${t.filename} (${t.guesses.length} guesses)`),this._loadPoolFile(t.filename,t,t.wordNumber||null,t.isWeekly||!1,t.weeklyNumber||null)):this._loadPoolFile(e.filename,null,e.wordNumber,!!e.isWeekly,e.weeklyNumber||null)}),this.socket.on("sp-new-game",e=>{this._loadPoolFile(e.filename,null,e.wordNumber,!!e.isWeekly,e.weeklyNumber||null)}),this.socket.on("sp-next-file",e=>{e.filename&&this._preloadFile(e.filename,e.wordNumber)}),this.socket.on("sp-win-recorded",e=>{e.winHistory&&(this.winHistory=e.winHistory)}),this.socket.on("sp-word-number",e=>{e.wordNumber&&e.word===this.targetWord&&(this.wordNumber=e.wordNumber,this.saveGame(),this.onWordNumber&&this.onWordNumber(e.wordNumber))}),this.socket.on("sp-pool-list",e=>{this.onPoolList&&this.onPoolList(e)})}async _loadPoolFile(e,t,n,s,r){this.isLoading=!0,this.onLoading&&this.onLoading(!0);try{let o;if(this._preloadedFile===e&&this._preloadedParsed)o=this._preloadedParsed,console.log(`[SP] Using preloaded game: "${o.targetWord}"`);else if(this._preloadedFile===e&&this._preloadedText)o=JSON.parse(this._preloadedText),console.log(`[SP] Parsed preloaded game: "${o.targetWord}"`);else{const a=performance.now(),l=await fetch(this._poolBase+e);if(!l.ok)throw new Error(`HTTP ${l.status}`);const c=await l.text(),d=performance.now();o=JSON.parse(c),console.log(`[SP] Loaded pool file in ${(d-a).toFixed(0)}ms download + ${(performance.now()-d).toFixed(0)}ms parse: "${o.targetWord}" (${(o.totalRankedWords||Object.keys(o.rankings).length).toLocaleString()} words)`)}if(this._preloadedFile=null,this._preloadedText=null,this._preloadedParsed=null,this.rankings=o.rankings,this.targetWord=o.targetWord,this.totalRankedWords=o.totalRankedWords||Object.keys(o.rankings).length,this.wordNumber=n||null,this.weeklyNumber=r||null,this.isWeekly=!!s,this._currentFilename=e,!this.wordNumber&&this.targetWord&&this.socket.emit("sp-get-word-number",{word:this.targetWord}),t&&t.filename===e){if(this.guesses=t.guesses||[],this.guessedWords=new Set(t.guessedWords||[]),this.isWon=t.isWon||!1,this.startTime=t.startTime||new Date().toISOString(),console.log(`[SP] Restored saved game: "${o.targetWord}" with ${this.guesses.length} guesses`),this._userCosmetics)for(const a of this.guesses)a.user&&(a.user.cosmetics=this._userCosmetics)}else this.guesses=[],this.guessedWords=new Set,this.isWon=!1,this.startTime=new Date().toISOString();this.isLoading=!1,this.onLoading&&this.onLoading(!1),this.onGameReady&&this.onGameReady(this._getGameState()),this._requestNextFile()}catch(o){console.error("[SP] Failed to load pool file:",o.message),this.isLoading=!1,this.onLoading&&this.onLoading(!1)}}_requestNextFile(){const e=this._getPlayedWords();this.targetWord&&!e.includes(this.targetWord)&&e.push(this.targetWord),this.socket.emit("sp-request-next-file",{playedWords:e})}async _preloadFile(e,t){if(this._preloadedFile!==e){this._preloadedFile=e,this._preloadedWordNumber=t||null,this._preloadedText=null,this._preloadedParsed=null;try{const n=await fetch(this._poolBase+e);if(!n.ok)throw new Error(`HTTP ${n.status}`);const s=await n.text();if(this._preloadedFile!==e)return;this._preloadedText=s,console.log(`[SP] Preloaded file: ${e} (${(s.length/1024/1024).toFixed(1)}MB)`),"requestIdleCallback"in window?requestIdleCallback(()=>{if(!(this._preloadedFile!==e||this._preloadedParsed))try{this._preloadedParsed=JSON.parse(this._preloadedText),console.log(`[SP] Pre-parsed: "${this._preloadedParsed.targetWord}"`)}catch{}}):setTimeout(()=>{if(!(this._preloadedFile!==e||this._preloadedParsed))try{this._preloadedParsed=JSON.parse(this._preloadedText),console.log(`[SP] Pre-parsed: "${this._preloadedParsed.targetWord}"`)}catch{}},500)}catch(n){console.error("[SP] Preload failed:",n.message),this._preloadedFile===e&&(this._preloadedFile=null)}}}submitGuess(e,t){if(this.isWon||this.isLoading||!this.rankings)return null;const n=W_(e,this.rankings,this.guessedWords,this.vocabSet);if(!n)return null;if(n.isDuplicate){const r=this.guesses.findIndex(o=>o.word===n.word);if(r!==-1){const o=this.guesses.splice(r,1)[0];o.lastBumper={displayName:t.displayName,profilePic:t.profilePic||null,platform:t.platform||"discord"},this.guesses.push(o)}return this.onDuplicateGuess&&this.onDuplicateGuess(n.word),n}this.guessedWords.add(n.word);const s={word:n.word,rank:n.rank,user:{id:t.id||null,platformUserId:t.id||t.username||null,displayName:t.displayName,username:t.username||null,profilePic:t.profilePic||null,platform:t.platform||"discord",customColor:t.customColor||null,cosmetics:this._userCosmetics||{}},timestamp:new Date().toISOString()};return this.guesses.push(s),this.onGuessResult&&this.onGuessResult(s),this.saveGame(),n.isWin&&(this.isWon=!0,this.socket.emit("sp-win",{word:n.word,guessCount:this.guesses.length}),this.onWin&&this.onWin({targetWord:this.targetWord,user:s.user,guessCount:this.guesses.length,wordNumber:this.wordNumber,pot:0})),n}requestNewGame(){this.clearSave(),this.socket.emit("new-game-request",{playedWords:this._getPlayedWords()})}_getGameState(){return{guesses:this.guesses,totalRankedWords:this.totalRankedWords,startTime:this.startTime,isWon:this.isWon,winner:null,targetWord:null,lastWinner:null,winHistory:this.winHistory,jackpotEnabled:!1,wordNumber:this.wordNumber,weeklyNumber:this.weeklyNumber,isWeekly:this.isWeekly}}_getPlayedWords(){try{return JSON.parse(localStorage.getItem("searchle_sp_played")||"[]")}catch{return[]}}getGameState(){return this._getGameState()}_saveKey(){return this._userId?`searchle_sp_save_${this._userId}`:null}saveGame(){const e=this._saveKey();if(!(!e||!this._currentFilename))try{const t={filename:this._currentFilename,guesses:this.guesses,guessedWords:Array.from(this.guessedWords),isWon:this.isWon,startTime:this.startTime,wordNumber:this.wordNumber,weeklyNumber:this.weeklyNumber,isWeekly:this.isWeekly};localStorage.setItem(e,JSON.stringify(t))}catch(t){console.warn("[SP] Failed to save game:",t.message)}}_loadSavedGame(){const e=this._saveKey();if(!e)return null;try{const t=localStorage.getItem(e);if(!t)return null;const n=JSON.parse(t);return n&&n.filename&&!n.isWon&&n.guesses&&n.guesses.length>0?n:null}catch{return null}}clearSave(){const e=this._saveKey();if(e)try{localStorage.removeItem(e)}catch{}}requestPoolList(){this.socket.emit("sp-get-pool-list")}playSpecificGame(e){this.clearSave(),this.socket.emit("sp-play-specific",{word:e})}}Tt&&document.body.classList.add("obs-mode");let Ge=[],ht=0,Ln=null,Di=!1,Je=[],Rt={},Ii=0,ti=null;function $o(){const i=window.location.hostname;return i==="subtextle.com"||i==="www.subtextle.com"?"https://wordtycoon.live":"http://localhost:3000"}const Pt=new sg(st),Nc=new rg,Dn=new Jg,tt=new ua(Pt.domRenderer);tt.setMode(window.__SP_MODE?"sp":"mp");const Ot=new i_(Pt.domRenderer);window.__SP_MODE&&Ot.setVisible(!1);const kt=new n_(Pt.domRenderer),yt=new t_(Pt.domRenderer,Nc),us=new s_(Pt.domRenderer),q_=new r_;Tt||q_.init(Dn);const Y_=new N_(Pt.viewport);let Fc=0;tt.onDrawerToggle=i=>{Fc=i,yt.setDrawerOffset(i),kt.setDrawerOffset(i),$i()};let ls=0;function $i(){const i=tt.height,e=Ot.visible?Ot.height:0,t=252,n=st.baseWidth/2,s=Fc,r=1350,o=Pt.viewport?Pt.viewport.height:2700,a=r-o/2;tt.object3D.position.set(n,-(i/2+a),50),Ot.setPosition(i+s+a),Ot.object3D.position.z=50,kt.setPosition(i+e+a+36),yt.setTopOffset(i+e+t+a+72),us.object3D.position.set(n,-(yt.topOffset-180),50),Pt.viewport&&yt.setViewHeight(Pt.viewport.height)}requestAnimationFrame(()=>{requestAnimationFrame(()=>$i())});function $_(){yt.updateList(Ge,ht,Je,Rt),kt.update(Ge,ht,Je,Rt),ti&&ti.user&&tt.updateWinner(ti.word,ti.user,ti.guessCount,Je,Rt),$i()}async function j_(){if(!da)try{const i=await fetch(`${$o()}/api/me/visibility`,{credentials:"include"});if(!i.ok)return;const e=await i.json(),t=e&&e.visibility&&typeof e.visibility=="object"?e.visibility:{};Yo(t),$_(),console.log("[MP] Viewer cosmetic visibility:",t)}catch(i){console.log("[MP] Viewer visibility fetch skipped:",i.message)}}const da=!!window.__SP_MODE;let Le=null;da&&(Le=new X_(Dn),(async()=>{let i=null;try{i=JSON.parse(localStorage.getItem("searchle_user"))}catch{}if(!i||!i.id){Tt||tt.setSPAnon();return}const e={displayName:i.globalName||i.username,username:i.username,profilePic:i.avatar||null};tt.setSPUser(e,null);try{const t=await fetch(`${$o()}/api/me/profile`,{credentials:"include"});if(t.ok){const n=await t.json();if(n.preferences&&n.preferences.cosmetic_visibility)try{const s=typeof n.preferences.cosmetic_visibility=="string"?JSON.parse(n.preferences.cosmetic_visibility):n.preferences.cosmetic_visibility;Yo(s),console.log("[SP] Viewer cosmetic visibility:",s)}catch{}if(n.ok&&n.cosmetics){const s={};for(const r of n.cosmetics)if(r.equipped&&r.category&&r.css_property)try{s[r.category]=JSON.parse(r.css_property)}catch{}if(Object.keys(s).length>0){tt.setSPUser(e,s),Le.setCosmetics(s);for(const r of Le.guesses)r.user&&(r.user.cosmetics=s);yt.applyCosmeticsToAll(s),console.log("[SP] Applied cosmetics:",Object.keys(s).join(", "))}}}}catch(t){console.log("[SP] Cosmetics fetch skipped:",t.message)}})(),Le.onWeeklyCompleted=()=>{document.dispatchEvent(new CustomEvent("sp-weekly-completed"))},Le.onGameReady=i=>{Ge=i.guesses||[],ht=i.totalRankedWords,Ln=i.startTime,Di=!1,Ii=0,i.winHistory&&(Je=i.winHistory),yt.updateList(Ge,ht,Je),kt.clear(),tt.reset(Ln),tt.updateWordNumber(i.isWeekly?i.weeklyNumber:i.wordNumber,i.isWeekly?"weekly":null),tt.updateStats(Je),us.hide(),$i(),document.dispatchEvent(new CustomEvent("sp-guesses-updated",{detail:{guesses:Ge,totalRankedWords:ht,winHistory:Je,wordNumber:i.wordNumber,weeklyNumber:i.weeklyNumber,isWeekly:!!i.isWeekly}}))},Le.onGuessResult=i=>{Ge=Le.guesses,ht=Le.totalRankedWords,Ii=Ge.length,yt.updateList(Ge,ht,Je),kt.update(Ge,ht,Je,Rt),tt.updateGuessCount(Ge.length),document.dispatchEvent(new CustomEvent("sp-guesses-updated",{detail:{guesses:Ge,totalRankedWords:ht,winHistory:Je,wordNumber:Le.wordNumber,weeklyNumber:Le.weeklyNumber,isWeekly:Le.isWeekly}}))},Le.onDuplicateGuess=i=>{Ge=Le.guesses,kt.update(Ge,ht,Je,Rt),kt.flashBump(i,null),document.dispatchEvent(new CustomEvent("sp-guesses-updated",{detail:{guesses:Ge,totalRankedWords:ht,winHistory:Je,wordNumber:Le.wordNumber,weeklyNumber:Le.weeklyNumber,isWeekly:Le.isWeekly}}))},Le.onWin=i=>{if(Di=!0,tt.stopTimer(),Le.clearSave(),Je.push({user:i.user,word:i.targetWord,wordNumber:i.wordNumber,guessCount:i.guessCount,timestamp:new Date().toISOString()}),tt.updateStats(Je),Tt||us.show(i.targetWord,i.user,null,i.guessCount),i.targetWord){try{const e=JSON.parse(localStorage.getItem("searchle_sp_played")||"[]");e.includes(i.targetWord)||(e.push(i.targetWord),localStorage.setItem("searchle_sp_played",JSON.stringify(e)))}catch{}try{const e=JSON.parse(localStorage.getItem("searchle_sp_won")||"[]");e.includes(i.targetWord)||(e.push(i.targetWord),localStorage.setItem("searchle_sp_won",JSON.stringify(e)))}catch{}}setTimeout(()=>{Le.requestNewGame()},5e3),document.dispatchEvent(new CustomEvent("sp-guesses-updated",{detail:{guesses:Ge,totalRankedWords:ht,winHistory:Je,wordNumber:Le.wordNumber,weeklyNumber:Le.weeklyNumber,isWeekly:Le.isWeekly}}))},Le.onLoading=i=>{document.dispatchEvent(new CustomEvent("sp-loading",{detail:{loading:i}}))},Le.onWordNumber=i=>{tt.updateWordNumber(Le.isWeekly?Le.weeklyNumber:i,Le.isWeekly?"weekly":null),document.dispatchEvent(new CustomEvent("sp-guesses-updated",{detail:{guesses:Ge,totalRankedWords:ht,winHistory:Je,wordNumber:i,weeklyNumber:Le.weeklyNumber,isWeekly:Le.isWeekly}}))},document.addEventListener("sp-guess-submit",i=>{!Le||!i.detail||Le.submitGuess(i.detail.input,i.detail.user)}),document.addEventListener("sp-new-game-request",()=>{Le&&Le.requestNewGame()}),Le.onPoolList=i=>{document.dispatchEvent(new CustomEvent("sp-pool-list",{detail:i}))},document.addEventListener("sp-request-pool-list",()=>{Le&&Le.requestPoolList()}),document.addEventListener("sp-play-specific",i=>{Le&&i.detail&&i.detail.word&&Le.playSpecificGame(i.detail.word)}),document.addEventListener("sp-user-login",async i=>{if(!i.detail||!i.detail.user)return;const e=i.detail.user,t={displayName:e.globalName||e.username,username:e.username,profilePic:e.avatar||null};tt.hideLoginOverlay(),tt.setSPUser(t,null);try{const n=await fetch(`${$o()}/api/me/profile`,{credentials:"include"});if(n.ok){const s=await n.json();if(s.preferences&&s.preferences.cosmetic_visibility)try{const r=typeof s.preferences.cosmetic_visibility=="string"?JSON.parse(s.preferences.cosmetic_visibility):s.preferences.cosmetic_visibility;Yo(r),console.log("[SP] Post-login viewer visibility:",r)}catch{}if(s.ok&&s.cosmetics){const r={};for(const o of s.cosmetics)if(o.equipped&&o.category&&o.css_property)try{r[o.category]=JSON.parse(o.css_property)}catch{}if(Object.keys(r).length>0){tt.setSPUser(t,r),Le.setCosmetics(r);for(const o of Le.guesses)o.user&&(o.user.cosmetics=r);yt.applyCosmeticsToAll(r),console.log("[SP] Post-login cosmetics applied:",Object.keys(r).join(", "))}}}}catch(n){console.log("[SP] Post-login cosmetics fetch skipped:",n.message)}}));da||(j_(),Dn.on("game-state",i=>{Ge=i.guesses||[],ht=i.totalRankedWords,Ln=i.startTime,Di=i.isWon,Ii=Ge.length,ti=i.lastWinner||null,i.winHistory&&(Je=i.winHistory),i.winCounts&&(Rt=i.winCounts);const e=i.jackpotEnabled!==!1;if(Ot.setVisible(e),Ot.setSpecialBadge(i.isDaily?"DAILY":i.isWeekly?"WEEKLY":null),Ot.setFrenzy(i.frenzy),yt.updateList(Ge,ht,Je,Rt),kt.update(Ge,ht,Je,Rt),tt.updateGuessCount(Ge.length),tt.startTimer(Ln),e&&Ot.start(Ln,Ii),i.lastWinner&&i.lastWinner.user&&tt.updateWinner(i.lastWinner.word,i.lastWinner.user,i.lastWinner.guessCount,Je,Rt),tt.updateStats(Je),Di&&i.winner&&!Tt&&us.show(i.targetWord||"???",i.winner,null,Ge.length),$i(),Tt&&Ge.length>0){const t=Ge.reduce((n,s)=>Math.max(n,s.rank),0);Gl(t)}}),Dn.on("new-guess",i=>{Ge.push(i),ht=i.totalRankedWords,Ii++,yt.updateList(Ge,ht,Je,Rt),kt.update(Ge,ht,Je,Rt),tt.updateGuessCount(Ge.length),Ot.addGuess(),Gl(i.rank)}),Dn.on("bump-guess",i=>{const e=Ge.findIndex(t=>t.word===i.word);if(e!==-1){const t=Ge.splice(e,1)[0];i.bumper&&(t.lastBumper=i.bumper),Ge.push(t),kt.update(Ge,ht,Je,Rt),kt.flashBump(i.word,i.bumper)}}),Dn.on("game-won",i=>{Di=!0,tt.stopTimer(),Ot.stop(),ti={word:i.targetWord,user:i.user,guessCount:i.guessCount},Je.push({user:i.user,word:i.targetWord,guessCount:i.guessCount,timestamp:new Date().toISOString()}),tt.updateStats(Je),Tt||us.show(i.targetWord,i.user,i.pot,i.guessCount),tt.updateWinner(i.targetWord,i.user,i.guessCount,Je,Rt),i.user&&i.user.cosmetics&&i.user.cosmetics.win_effect&&Y_.playWinEffect(i.user.cosmetics.win_effect)}),Dn.on("new-game",i=>{Ge=[],ht=i.totalRankedWords,Ln=i.startTime,Di=!1,Ii=0,yt.updateList([],ht,Je,Rt),kt.clear(),tt.reset(Ln),Ot.start(Ln,0)}),Dn.on("frenzy-update",i=>{Ot.setFrenzy(i)}));let oi=0;const K_=.93,Z_=.5;function Qs(i){ls+=i;const e=yt.getMaxScroll();ls=Math.max(0,Math.min(ls,e)),yt.setScrollY(ls),$i()}let er=-1;function Gl(i){if(!Tt)return;const e=yt.getRowHeight(),s=-(1350+(Pt.viewport?Pt.viewport.height:2700)/2)+e+yt.topOffset+(i-1)*e,r=Math.max(0,e/2-72);er=Math.max(0,Math.min(s,r))}document.addEventListener("wheel",i=>{i.target.closest&&i.target.closest("#sp-pool-browser-overlay")||(i.preventDefault(),oi+=i.deltaY*.4)},{passive:!1});let jo=0,Oi=[];document.addEventListener("touchstart",i=>{jo=i.touches[0].clientY,Oi=[],oi=0},{passive:!0});document.addEventListener("touchmove",i=>{if(i.target.closest&&i.target.closest("#sp-pool-browser-overlay"))return;const e=i.touches[0].clientY,t=jo-e;jo=e,Math.abs(t)>0&&(i.preventDefault(),Qs(t*3),Oi.push({v:t*3,t:performance.now()}),Oi.length>5&&Oi.shift())},{passive:!1});document.addEventListener("touchend",()=>{const i=performance.now(),e=Oi.filter(t=>i-t.t<100);e.length>0&&(oi=e.reduce((t,n)=>t+n.v,0)/e.length),Oi=[]},{passive:!0});Pt.onUpdate(i=>{if(Tt&&er>=0){const e=er-ls;Math.abs(e)>1?Qs(e*Math.min(1,6*i)):(e!==0&&Qs(e),er=-1)}Math.abs(oi)>Z_?(Qs(oi),oi*=K_):oi=0,Nc.update(),yt.update(i),kt.animate(i)});Pt.start();
