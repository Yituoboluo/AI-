export const categoryNames={food:'食品饮料',electronics:'数码产品',apparel:'服装',home:'家居',general:'通用商品'};
export function visualFrame(layout,width,height){
 const frames={center:{product:[.22,.32,.56,.57],text:[.08,.065,.84,.225]},right:{product:[.48,.29,.45,.60],text:[.065,.17,.355,.58]},left:{product:[.07,.31,.50,.58],text:[.625,.13,.315,.59]}};
 const frame=frames[layout]||frames.center,rect=([x,y,w,h])=>({x:x*width,y:y*height,w:w*width,h:h*height});
 return {product:rect(frame.product),text:rect(frame.text)};
}
const families={serif:'"Songti SC","SimSun",serif',sans:'"Microsoft YaHei","PingFang SC",sans-serif',display:'"Microsoft YaHei","PingFang SC",sans-serif'};
function linesFor(ctx,text,width,tracking){const lines=[];let line='';for(const char of Array.from(text)){if(line&&ctx.measureText(line+char).width+Array.from(line).length*tracking>width){lines.push(line);line='';}line+=char;}if(line)lines.push(line);return lines;}
function textBlock(ctx,text,box,{family,size,weight=500,tracking=0,lineHeight=1.24}){
 if(!text)return box.y;let lines;
 do{ctx.font=`${weight} ${size}px ${family}`;lines=linesFor(ctx,text,box.w,tracking);if(lines.length*size*lineHeight<=box.h)break;size-=2;}while(size>24);
 ctx.textBaseline='top';lines.forEach((line,index)=>{let x=box.x;for(const ch of Array.from(line)){ctx.fillText(ch,x,box.y+index*size*lineHeight);x+=ctx.measureText(ch).width+tracking;}});
 return box.y+lines.length*size*lineHeight;
}
function textTone(ctx,box){
 const pixels=ctx.getImageData(Math.round(box.x),Math.round(box.y),Math.max(1,Math.floor(box.w)),Math.max(1,Math.floor(box.h))).data;
 let light=0,count=0;for(let i=0;i<pixels.length;i+=160){light+=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;count++;}
 return light/Math.max(1,count)>140?'#292522':'#FFF8ED';
}
function drawGroundedProduct(ctx,product,box,width){
 const layer=document.createElement('canvas');layer.width=product.width;layer.height=product.height;
 const c=layer.getContext('2d',{willReadFrequently:true});c.drawImage(product,0,0);
 const pixels=c.getImageData(0,0,layer.width,layer.height).data;let left=layer.width,top=layer.height,right=-1,bottom=-1;
 for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++)if(pixels[(y*layer.width+x)*4+3]>40){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 if(right<left)return;
 const sw=right-left+1,sh=bottom-top+1,s=Math.min(box.w/sw,box.h/sh),pw=sw*s,ph=sh*s,px=box.x+(box.w-pw)/2,py=box.y+box.h-ph;
 // Anchor to actual opaque pixels, not the cutout's transparent padding.
 let footLeft=right,footRight=left;
 for(let y=Math.max(top,bottom-Math.ceil(sh*.035));y<=bottom;y++)for(let x=left;x<=right;x++)if(pixels[(y*layer.width+x)*4+3]>96){footLeft=Math.min(footLeft,x);footRight=Math.max(footRight,x);}
 if(footRight<footLeft){footLeft=left;footRight=right;}
 const cx=px+((footLeft+footRight)/2-left)*s,cy=py+ph,rx=Math.max(width*.012,(footRight-footLeft+1)*s*.49);
 for(const [blur,alpha,spread] of [[width*.009,.13,1.18],[width*.002,.29,.96]]){ctx.save();ctx.filter=`blur(${blur}px)`;ctx.fillStyle=`rgba(34,25,18,${alpha})`;ctx.beginPath();ctx.ellipse(cx,cy,rx*spread,Math.max(2,rx*.095),0,0,Math.PI*2);ctx.fill();ctx.restore();}
 ctx.drawImage(product,left,top,sw,sh,px,py,pw,ph);
}
export function drawVisualCreative(ctx,background,product,concept,title,subtitle,width,height,{integrated=false}={}){
 const frame=visualFrame(concept.layout,width,height),scale=Math.max(width/background.width,height/background.height);
 ctx.drawImage(background,(width-background.width*scale)/2,(height-background.height*scale)/2,background.width*scale,background.height*scale);
 // Integrated images already contain the product, light and shadow. Adding the
 // cutout here again would recreate the pasted-on look and duplicate the SKU.
 if(!integrated&&product)drawGroundedProduct(ctx,product,frame.product,width);
 const text=frame.text,color=textTone(ctx,text);ctx.save();ctx.fillStyle=color;
 // Keep the photograph intact; soften only the glyph edges for readability.
 ctx.shadowColor=color==='#292522'?'rgba(255,255,255,.4)':'rgba(0,0,0,.3)';ctx.shadowBlur=2;
 const serif=concept.font==='serif',display=concept.font==='display',size=concept.layout==='center'?(display?88:76):(display?80:68),reserve=subtitle?height*.11:0;
 const end=textBlock(ctx,title,{...text,h:text.h-reserve},{family:families[concept.font]||families.sans,size,weight:serif?500:display?800:600,tracking:serif?1.3:0,lineHeight:serif?1.32:1.18});
 if(title){ctx.fillStyle=concept.palette?.accent||color;ctx.fillRect(text.x,end+16,display?82:48,display?5:3);}
 if(subtitle){ctx.fillStyle=color;textBlock(ctx,subtitle,{x:text.x,y:end+(title?42:0),w:text.w,h:Math.max(96,text.y+text.h-end-40)},{family:families.sans,size:28,weight:400,lineHeight:1.45});}
 ctx.restore();
}
