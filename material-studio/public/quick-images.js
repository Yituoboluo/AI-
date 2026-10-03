export async function readImage(src){const image=new Image();image.decoding='async';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('图片读取超时，请重试。')),20000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('图片无法读取，请更换 PNG、JPG 或 WebP 图片。'));};image.src=src;});if(image.naturalWidth*image.naturalHeight>40000000)throw new Error('图片像素过大，请缩小后再上传。');return image;}
const canvas=(width,height)=>Object.assign(document.createElement('canvas'),{width,height});
export async function prepareProduct(file,onProgress,signal){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw new Error('请选择 8 MB 以内的 PNG、JPG 或 WebP 图片。');
 const url=URL.createObjectURL(file);let img;try{img=await readImage(url);}finally{URL.revokeObjectURL(url);}
 const scale=Math.min(1,1600/Math.max(img.width,img.height)),source=canvas(Math.max(1,Math.round(img.width*scale)),Math.max(1,Math.round(img.height*scale))),ctx=source.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,source.width,source.height);
 const original=source.toDataURL('image/png');onProgress('original',original,{width:source.width,height:source.height});
 const full=ctx.getImageData(0,0,source.width,source.height);let transparent=0;for(let i=3;i<full.data.length;i+=4)if(full.data[i]<240)transparent++;
 if(transparent>source.width*source.height*.03)return {original,cutout:trimSubject(source),segmentation:'transparent'};
 const small=canvas(320,320),sc=small.getContext('2d',{willReadFrequently:true});sc.drawImage(source,0,0,320,320);const rgba=sc.getImageData(0,0,320,320).data,pixels=new Float32Array(3*320*320),mean=[.485,.456,.406],std=[.229,.224,.225];let max=1;for(let i=0;i<rgba.length;i++)if(i%4!==3)max=Math.max(max,rgba[i]);for(let i=0;i<320*320;i++)for(let channel=0;channel<3;channel++)pixels[channel*320*320+i]=(rgba[i*4+channel]/max-mean[channel])/std[channel];
 let mask;
 try{mask=await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./cutout-worker.js',import.meta.url),{type:'module'});
  const finish=(error,data)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(data);};
  const abort=()=>finish(new Error('已取消此图片处理。'));
  const timer=setTimeout(()=>finish(new Error('抠图用时较长，请重试或改用原图。')),120000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  worker.onmessage=({data})=>{if(data.phase==='done')finish(null,new Float32Array(data.mask));else if(data.phase==='error')finish(new Error(data.message));else onProgress(data.phase);};
  worker.onerror=()=>finish(new Error('抠图组件暂时无法载入，请重试或改用原图。'));
  worker.postMessage({pixels:pixels.buffer},[pixels.buffer]);
 });}catch(error){error.original=original;throw error;}
 let min=Infinity,maximum=-Infinity;for(const value of mask){min=Math.min(min,value);maximum=Math.max(maximum,value);}const range=maximum-min;if(!Number.isFinite(range)||range<1e-6){const e=new Error('未能识别清晰的商品轮廓，请换图或改用原图。');e.original=original;throw e;}
 const alpha=sc.createImageData(320,320);let foreground=0;for(let i=0;i<mask.length;i++){const value=Math.max(0,Math.min(1,(mask[i]-min)/range));alpha.data[i*4+3]=Math.round(value*255);if(value>.5)foreground++;}
 if(foreground<320*320*.005||foreground>320*320*.98){const e=new Error('商品轮廓不够明确，请换图或改用原图。');e.original=original;throw e;}
 sc.putImageData(alpha,0,0);const maskCanvas=canvas(source.width,source.height),mc=maskCanvas.getContext('2d');mc.drawImage(small,0,0,source.width,source.height);ctx.globalCompositeOperation='destination-in';ctx.drawImage(maskCanvas,0,0);ctx.globalCompositeOperation='source-over';
 return {original,cutout:trimSubject(source),segmentation:'automatic'};
}
function trimSubject(source){const {width:w,height:h}=source,data=source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;let left=w,right=0,top=h,bottom=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}if(right<=left||bottom<=top)return source.toDataURL('image/png');const pad=Math.ceil(Math.max(right-left,bottom-top)*.04),output=canvas(right-left+1+pad*2,bottom-top+1+pad*2);output.getContext('2d').drawImage(source,left,top,right-left+1,bottom-top+1,pad,pad,right-left+1,bottom-top+1);return output.toDataURL('image/png');}
function drawText(ctx,text,x,y,width,size,maxLines=2){let line='',lines=[];ctx.font=`600 ${size}px "Microsoft YaHei",sans-serif`;for(const ch of text){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line='';}line+=ch;}if(line)lines.push(line);if((lines.length>maxLines||(lines.length>1&&Array.from(lines.at(-1)).length===1))&&size>22)return drawText(ctx,text,x,y,width,size-2,maxLines);lines.slice(0,maxLines).forEach((value,i)=>ctx.fillText(value,x,y+i*size*1.3));return y+lines.length*size*1.3;}
export async function composeCreative(job,edits){
 if(job.result.quick.visualVersion===2){
  const {drawVisualCreative}=await import('./visual-layout.js'),plan=job.result.quick,outputs=[];
  const integrated=item=>plan.renderRoute==='reference_scene_edit'&&item.renderMode==='integrated';
  const product=job.result.backgrounds.some(item=>!integrated(item))?await readImage(plan.subjectImageUrl):null;
  for(const item of job.result.backgrounds){
   const concept=plan.concepts.find(c=>c.id===item.conceptId),previous=job.result.compositions?.find(c=>c.conceptId===item.conceptId),changed=edits?.conceptId===item.conceptId;
   const title=changed?edits.title:(previous?.title??concept.title),subtitle=changed?edits.subtitle:(previous?.subtitle??concept.subtitle),W=1080,H=plan.ratio==='portrait'?1440:1080,out=canvas(W,H);
   drawVisualCreative(out.getContext('2d'),await readImage(item.imageUrl),product,concept,title,subtitle,W,H,{integrated:integrated(item)});
   outputs.push({data:out.toDataURL('image/png'),title,subtitle,layout:concept.layout,conceptId:concept.id});
  }
  return outputs;
 }
 const plan=job.result.quick,background=await readImage(job.result.imageUrl),product=await readImage(plan.subjectImageUrl),outputs=[];
 const title=edits?.title??plan.title,subtitle=edits?.subtitle??plan.subtitle;
 for(let index=0;index<2;index++){
  const layout=index===0||plan.lockedLayout?plan.layout:(plan.layout==='center'?'right':'center'),W=1080,H=plan.ratio==='portrait'?1440:1080,out=canvas(W,H),ctx=out.getContext('2d');
  const bgScale=Math.max(W/background.width,H/background.height);ctx.drawImage(background,(W-background.width*bgScale)/2,(H-background.height*bgScale)/2,background.width*bgScale,background.height*bgScale);
  const veil=ctx.createLinearGradient(0,0,layout==='right'?850:0,layout==='right'?0:H*.6);veil.addColorStop(0,'rgba(255,253,248,.86)');veil.addColorStop(1,'rgba(255,253,248,0)');ctx.fillStyle=veil;ctx.fillRect(0,0,W,H);
  const box=layout==='center'?{x:130,y:title?310:130,w:820,h:H-(title?420:230)}:{x:470,y:H*.24,w:540,h:H*.62};
  const scale=Math.min(box.w/product.width,box.h/product.height)*(index===1&&plan.lockedLayout ? .92 : 1),pw=product.width*scale,ph=product.height*scale;ctx.save();ctx.filter='drop-shadow(0px 24px 22px rgba(26,22,17,.16))';ctx.drawImage(product,box.x+(box.w-pw)/2,box.y+(box.h-ph)/2,pw,ph);ctx.restore();
  ctx.fillStyle='#292522';const x=layout==='center'?86:72,y=layout==='center'?158:H*.29,width=layout==='center'?900:360;
  const end=drawText(ctx,title,x,y,width,layout==='center'?72:62,layout==='center'?2:3);ctx.fillStyle='#65574a';if(subtitle)drawText(ctx,subtitle,x,end+18,width,30,3);
  outputs.push({data:out.toDataURL('image/png'),title,subtitle,layout});
 }
 return outputs;
}
