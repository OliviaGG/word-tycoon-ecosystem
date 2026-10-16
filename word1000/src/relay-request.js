'use strict';
function createRelayRequest({baseUrl='http://localhost:3000',request=fetch}={}) {
 const base=new URL(baseUrl);
 if(base.protocol!=='http:'||!['localhost','127.0.0.1'].includes(base.hostname)||base.port!=='3000'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Invalid local Relay destination');
 return async function relayRequest(input,options={}) {
  const url=new URL(input,base);
  if(url.origin!==base.origin||url.username||url.password||url.hash)throw Error('Invalid Relay request destination');
  return request(url.href,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
 };
}
module.exports={createRelayRequest};
