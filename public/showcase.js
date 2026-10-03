const works = [
  {id:'coffee',file:'coffee-editorial.webp',title:'把日常，慢慢冲好',category:'咖啡 · 日常内容',description:'暖光静物，让商品与生活自然相遇。',alt:'带中文文案的咖啡电商创意海报'},
  {id:'scent',file:'scent-editorial.webp',title:'留一点香气给生活',category:'香氛 · 品牌表达',description:'光影与材质，为安静的画面留出层次。',alt:'带中文文案的香氛电商创意海报'},
  {id:'audio',file:'audio-editorial.webp',title:'让声音，自成空间',category:'耳机 · 商品上新',description:'蓝灰色调与金属质感，呈现克制的数码美学。',alt:'带中文文案的耳机电商创意海报'}
];

const source = work => `assets/showcase/${work.file}`;

export function showcaseSection(context='home') {
  return `<section class="creative-showcase" aria-labelledby="${context}-showcase-title">
    <div class="showcase-heading"><div><h2 id="${context}-showcase-title">电商创意精选</h2><p>咖啡、香氛、数码，看看不同品类的视觉表达。</p></div><button class="button secondary" data-shell="new">开始我的创作 <span data-icon="arrow"></span></button></div>
    <div class="showcase-grid">${works.map(work=>`<article class="showcase-work">
      <div class="showcase-image-frame"><button class="showcase-image-button" data-showcase-open="${work.id}" aria-label="放大查看${work.alt}"><img src="${source(work)}" alt="${work.alt}" width="1254" height="1254" loading="lazy" decoding="async" data-showcase-image="${work.id}"><span class="showcase-view">查看大图 <span data-icon="search"></span></span></button><div class="showcase-image-error" hidden><p>图片暂未载入</p><button class="button secondary" data-showcase-retry="${work.id}">重新加载</button></div></div>
      <div class="showcase-caption"><span>${work.category}</span><h3>${work.title}</h3><p>${work.description}</p></div>
    </article>`).join('')}</div>
    <p class="showcase-note">AI 视觉样例 · 用于展示创意方向</p>
  </section>`;
}

let dialog;
let returnFocus;

function ensureDialog(work) {
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.className='showcase-dialog';
  dialog.setAttribute('aria-labelledby','showcase-preview-title');
  dialog.setAttribute('aria-describedby','showcase-preview-note');
  dialog.innerHTML=`<div class="showcase-preview-bar"><div><h2 id="showcase-preview-title"></h2><p id="showcase-preview-note">AI 视觉样例 · 用于展示创意方向</p></div><button class="showcase-close" data-showcase-close aria-label="关闭大图预览" autofocus>关闭</button></div><div class="showcase-preview-image"><img src="${source(work)}" alt="${work.alt}" width="1254" height="1254"><div class="showcase-preview-error" hidden><p>图片暂未载入，请关闭后重新加载。</p></div></div><div class="showcase-preview-footer"><p>从你自己的商品出发，开始新的创作。</p><button class="button primary" data-shell="new" data-showcase-create>开始我的创作</button></div>`;
  dialog.querySelector('img').addEventListener('error',()=>{
    dialog.querySelector('img').hidden=true;
    dialog.querySelector('.showcase-preview-error').hidden=false;
  });
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  });
  dialog.addEventListener('close',()=>{
    document.body.classList.remove('showcase-preview-open');
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  });
  document.body.append(dialog);
  return dialog;
}

export function installShowcase() {
  document.addEventListener('error',event=>{
    const img=event.target;
    if(!(img instanceof HTMLImageElement)||!img.dataset.showcaseImage)return;
    const frame=img.closest('.showcase-image-frame');
    frame.querySelector('.showcase-image-button').hidden=true;
    frame.querySelector('.showcase-image-error').hidden=false;
  },true);
  document.addEventListener('load',event=>{
    const img=event.target;
    if(!(img instanceof HTMLImageElement)||!img.dataset.showcaseImage)return;
    img.closest('.showcase-image-frame').classList.add('image-ready');
  },true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.hasAttribute('data-showcase-close')||button.hasAttribute('data-showcase-create'))dialog?.close();
    if(button.dataset.showcaseRetry){
      const frame=button.closest('.showcase-image-frame'),img=frame.querySelector('img'),work=works.find(work=>work.id===button.dataset.showcaseRetry);
      if(!work)return;
      frame.querySelector('.showcase-image-error').hidden=true;
      frame.querySelector('.showcase-image-button').hidden=false;
      frame.classList.remove('image-ready');
      img.src=`${source(work)}?reload=${Date.now()}`;
    }
    if(!button.dataset.showcaseOpen)return;
    const work=works.find(work=>work.id===button.dataset.showcaseOpen);
    if(!work)return;
    returnFocus=button;
    const preview=ensureDialog(work),img=preview.querySelector('img');
    preview.querySelector('#showcase-preview-title').textContent=work.title;
    preview.querySelector('.showcase-preview-error').hidden=true;
    img.hidden=false;
    img.alt=work.alt;
    img.src=button.querySelector('img').src;
    preview.showModal();
    document.body.classList.add('showcase-preview-open');
  });
}
