'use strict';
const $ = id => document.getElementById(id);
const appBody = $('appBody');
const contentViewport = $('content-viewport');
const modalBackdrop = $('modalBackdrop');
const modal = $('modal');
const modalFrame = $('modalFrame');
const seasonSelect = $('seasonSelect');
const episodeSelect = $('episodeSelect');
const seControls = $('seControls');
const THEMES = ['spotify','light','2022purple','cyberpunk','midnight','solarized','crimson'];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let storageWarning = false;
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { if (!storageWarning) { storageWarning = true; announce('Browser storage is unavailable. Changes will last for this visit only.'); } } }
function announce(message) { $('announcement').textContent = message; }
let saved = readStore('cinema.watchlist.v1', []);
if (!Array.isArray(saved)) saved = [];
let watched = readStore('cinema.history.v1', {});
if (!watched || typeof watched !== 'object' || Array.isArray(watched)) watched = {};
const catalog = new Map();
const cards = new Map();
const detailsCache = new Map();
const seasonCache = new Map();
let activePage = 'movies';
let current = null;
let playerVersion = 0;
let detailVersion = 0;
let selectedDetail = null;
let randomType = null;
let currentEpisodes = [];
const dialogs = [];
const metadataQueue = [];
let requestsRunning = 0;
const API_KEY = '2206ab98a3adf76bf6f6cda98e32f1b0';
const posterURL = (path, size = 'w342') => path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
function changeTheme(themeName, save = true) {
 const theme = THEMES.includes(themeName) ? themeName : 'cyberpunk';
 appBody.classList.remove(...THEMES.map(t => `theme-${t}`));
 appBody.classList.add(`theme-${theme}`);
 if (save) { try { localStorage.setItem('theme', theme); } catch { announce('Theme applies for this visit.'); } }
 document.querySelectorAll('.theme-button').forEach(b => { const active = b.getAttribute('onclick')?.includes(`'${theme}'`); b.classList.toggle('active', !!active); b.setAttribute('aria-pressed', String(!!active)); });
}
function syncDialogs() {
 const top = dialogs.at(-1)?.el;
 for (const child of document.body.children) {
  if (['SCRIPT','STYLE'].includes(child.tagName) || child.id === 'announcement') continue;
  child.inert = Boolean(top && child !== top && !child.contains(top));
 }
 $('updateBtn').style.visibility = top ? 'hidden' : '';
}
function showDialog(el) {
 if (dialogs.some(d => d.el === el)) return;
 dialogs.push({el, opener: document.activeElement});
 el.hidden = false; el.style.display = 'flex'; el.classList.add('show'); el.setAttribute('aria-hidden','false');
 syncDialogs();
 requestAnimationFrame(() => { if (dialogs.at(-1)?.el === el) (el.querySelector('button:not([disabled]), input, select') || el).focus(); });
}
function hideDialog(el) {
 const index = dialogs.findIndex(d => d.el === el);
 if (index < 0) return;
 const [{opener}] = dialogs.splice(index,1);
 el.style.display = 'none'; el.hidden = true; el.classList.remove('show'); el.setAttribute('aria-hidden','true');
 syncDialogs();
 if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
 else (dialogs.at(-1)?.el.querySelector('button') || document.querySelector(`[data-page="${activePage}"]`))?.focus();
}
async function api(path, extra = '') {
 const response = await fetch(`https://api.themoviedb.org/3/${path}?api_key=${API_KEY}${extra}`, {signal: AbortSignal.timeout(12000)});
 if (!response.ok) throw new Error(`Metadata request failed (${response.status})`);
 return response.json();
}
function pumpQueue() {
 while (requestsRunning < 5 && metadataQueue.length) {
  const task = metadataQueue.shift(); requestsRunning++;
  task.run().then(task.resolve, task.reject).finally(() => { requestsRunning--; pumpQueue(); });
 }
}
function enqueue(run, priority) { return new Promise((resolve,reject) => { const task={run,resolve,reject}; priority ? metadataQueue.unshift(task) : metadataQueue.push(task); pumpQueue(); }); }
function ensureDetails(item, priority = false) {
 if (detailsCache.has(item.key)) return detailsCache.get(item.key);
 const promise = enqueue(async () => {
  const data = await api(`${item.type}/${item.id}`, '&append_to_response=external_ids');
  Object.assign(item, {title:data.title || data.name || item.title, poster:data.poster_path, backdrop:data.backdrop_path, overview:data.overview, year:(data.release_date || data.first_air_date || '').slice(0,4), rating:data.vote_average || 0, runtime:data.runtime, imdb:data.imdb_id || data.external_ids?.imdb_id, seasons:(data.seasons || []).filter(s=>s.episode_count > 0), loaded:true});
  if (data.genres?.length) item.genres = [...new Set(data.genres.flatMap(g=>g.name.replace('Science Fiction','Sci-Fi').replace('Sci-Fi & Fantasy','Sci-Fi,Fantasy').replace('Action & Adventure','Action,Adventure').split(',')))];
  renderItemCards(item);
  renderContinueWatching();
  scheduleFilter(item.type);
  return item;
 }, priority).catch(error => { detailsCache.delete(item.key); item.failed = true; renderItemCards(item); throw error; });
 detailsCache.set(item.key,promise); return promise;
}
const filterTimers = {};
function scheduleFilter(type) { clearTimeout(filterTimers[type]); filterTimers[type]=setTimeout(()=>filterContent(type),150); }
const posterObserver = new IntersectionObserver(entries => entries.forEach(entry => {
 if (!entry.isIntersecting) return;
 posterObserver.unobserve(entry.target);
 const item = catalog.get(entry.target.dataset.key);
 if (item) ensureDetails(item).catch(()=>{});
}), {root:contentViewport,rootMargin:'350px'});
function cardMarkup(item) {
 const history = watched[item.key];
 const subtitle = [item.year, item.rating ? `★ ${item.rating.toFixed(1)}` : '', history ? (item.type === 'tv' ? `Last opened S${history.season || 1} · E${history.episode || 1}` : 'Recently opened') : ''].filter(Boolean).join(' · ');
 return `<button class="tmdb-card" data-detail="${item.key}" aria-label="Details for ${escapeHTML(item.title)}"><div class="tmdb-inner">${item.poster ? `<img class="tmdb-img" src="${posterURL(item.poster)}" alt="" loading="lazy" decoding="async">` : `<div class="placeholder">${escapeHTML(item.title)}</div>`}</div><div class="card-caption"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(subtitle || (item.type==='tv'?'TV show':'Movie'))}</span></div></button><button class="bookmark" data-save="${item.key}" aria-label="${saved.includes(item.key)?'Remove from':'Add to'} My List: ${escapeHTML(item.title)}" aria-pressed="${saved.includes(item.key)}">${saved.includes(item.key)?'♥':'♡'}</button>${item.failed && !item.loaded ? `<button class="retry-card" data-retry="${item.key}">Retry artwork</button>` : ''}`;
}
function renderItemCards(item) {
 for (const el of cards.get(item.key) || []) {
  if (!el.isConnected) { cards.get(item.key).delete(el); continue; }
  const focused = el.contains(document.activeElement) ? document.activeElement?.dataset.save ? 'save' : 'detail' : null;
  el.innerHTML = cardMarkup(item);
  if (focused) el.querySelector(`[data-${focused}]`)?.focus();
 }
}
function makeCard(item) {
 const el = document.createElement('article'); el.className='catalog-card'; el.dataset.key=item.key;
 el.innerHTML=cardMarkup(item);
 if (!cards.has(item.key)) cards.set(item.key,new Set());
 cards.get(item.key).add(el); posterObserver.observe(el); return el;
}
function fillGrid(el, items, empty) {
 el.replaceChildren();
 if (!items.length) { const p=document.createElement('p'); p.className='empty-state'; p.textContent=empty; el.append(p); }
 else items.forEach(item=>el.append(makeCard(item)));
}
function toggleSave(key) {
 saved = saved.includes(key) ? saved.filter(k=>k!==key) : [...saved,key]; saveStore('cinema.watchlist.v1',saved);
 renderItemCards(catalog.get(key));
 if (activePage==='list') renderLibrary();
 if (selectedDetail?.key === key) updateDetailSave();
 announce(saved.includes(key)?'Added to My List.':'Removed from My List.');
}
function renderLibrary() {
 fillGrid($('savedGrid'),saved.map(k=>catalog.get(k)).filter(Boolean),'Your list is empty. Tap the heart on a poster to save it.');
 fillGrid($('historyGrid'),Object.entries(watched).sort((a,b)=>(b[1]?.opened || 0)-(a[1]?.opened || 0)).map(([k])=>catalog.get(k)).filter(Boolean),'No history yet. Open a movie or episode to find it here.');
 $('clearHistory').hidden=!Object.keys(watched).length;
}
function visibleItems(type) {
 const search=$(`${type}Search`)?.value.trim().toLowerCase() || '';
 const genre=$(`${type}GenreFilter`)?.value || '';
 return [...catalog.values()].filter(i=>i.type===type && !i.special && i.title.toLowerCase().includes(search) && (!genre || i.genres.includes(genre)));
}
function filterContent(type) {
 const grid=$(`${type}Grid`); if (!grid) return;
 const visible=visibleItems(type); const keys=new Set(visible.map(i=>i.key));
 const sort=$(`${type}Sort`).value;
 const sorted=[...grid.children].sort((a,b)=>{
  const x=catalog.get(a.dataset.key),y=catalog.get(b.dataset.key);
  if(sort==='title') return x.title.localeCompare(y.title);
  if(sort==='year') return (Number(y.year)||0)-(Number(x.year)||0) || x.title.localeCompare(y.title);
  if(sort==='rating') return (y.rating||0)-(x.rating||0) || x.title.localeCompare(y.title);
  return y.order-x.order;
 });
 sorted.forEach(el=> { el.hidden=!keys.has(el.dataset.key); grid.append(el); });
 $(`${type}Count`).textContent=`${visible.length} ${type==='tv'?'shows':'movies'}`;
 $(`${type}Empty`).hidden=visible.length!==0;
 document.querySelector(`[data-pick="${type}"]`).disabled=!visible.length;
}
function clearFilters(type) { $(`${type}Search`).value=''; $(`${type}GenreFilter`).value=''; filterContent(type); }
function switchPage(pageId, updateHistory = true) {
 const allowed=['movies','tv','settings','list','history','chad','home','credits'];
 if (!allowed.includes(pageId)) pageId='movies';
 if(current) closeModal();
 hideDetails(); closePopup(); hideUpdateLog();
 activePage=pageId;
 document.querySelectorAll('.content-page').forEach(p=>p.classList.toggle('active',p.id===`${pageId}-page`));
 document.querySelectorAll('[data-page]').forEach(a=>{ const active=a.dataset.page===pageId; a.classList.toggle('active',active); if(active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
 contentViewport.scrollTop=0;
 if(updateHistory) { const url=new URL(location.href);url.searchParams.set('view',pageId);url.searchParams.delete('title');history.pushState(null,'',url); }
 if(pageId==='list'||pageId==='history') renderLibrary();
 if(pageId==='movies'||pageId==='tv')renderContinueWatching();
 if(pageId==='movies'||pageId==='tv') filterContent(pageId==='movies'?'movie':'tv');
}
async function loadSortMetadata(type) {
 const status=$(`${type}Count`); status.textContent='Loading ratings and years…';
 await Promise.allSettled([...catalog.values()].filter(i=>i.type===type&&!i.special).map(i=>ensureDetails(i)));
 filterContent(type);
}
function renderFeatured() {
 const movies=[...catalog.values()].filter(i=>i.type==='movie'&&!i.special).sort((a,b)=>Number(a.id)-Number(b.id));
 const day=Math.floor(Date.now()/86400000);
 if(spotlightDay===day)return;
 spotlightDay=day;
 const feature=movies[day % movies.length];
 if(feature) {
  $('featured').innerHTML=`<section class="feature"><div class="feature-copy"><p class="eyebrow">TONIGHT’S SPOTLIGHT</p><h1>${escapeHTML(feature.title)}</h1><p id="featureSynopsis">Explore tonight’s featured film, or find your next favorite below.</p><button class="cinema-button primary" data-detail="${feature.key}">Explore film</button></div></section>`;
  ensureDetails(feature,true).then(i=> { if(spotlightDay!==day)return;const el=$('featured').firstElementChild; if(i.backdrop) el.style.backgroundImage=`linear-gradient(90deg,rgba(7,9,18,.96),rgba(7,9,18,.25)),url("${posterURL(i.backdrop,'w1280')}")`; $('featureSynopsis').textContent=i.overview || 'Explore tonight’s featured film.'; }).catch(()=>{});
 }

}
function updateDetailSave() { const b=$('detailSave'); if(b && selectedDetail) { b.textContent=saved.includes(selectedDetail.key)?'♥ Saved to My List':'♡ Add to My List';b.setAttribute('aria-pressed',String(saved.includes(selectedDetail.key))); } }
function renderDetails(item, loading = false, error = false) {
 const focusedId=$('detailsContent').contains(document.activeElement)?document.activeElement.id:null;
 const record=watched[item.key];
 const facts=[item.type==='tv'?'TV show':'Movie',item.year,item.rating?`★ ${item.rating.toFixed(1)} / 10`:null,item.runtime?`${item.runtime} min`:null,item.type==='tv'&&item.seasons?`${item.seasons.filter(s=>s.season_number>0).length} seasons`:null].filter(Boolean);
 $('detailsContent').innerHTML=`<div class="detail-heading">${item.poster?`<img src="${posterURL(item.poster)}" alt="" class="detail-poster">`:''}<div><p class="eyebrow">${escapeHTML(item.genres.join(' · '))}</p><h2 id="detailsTitle">${escapeHTML(item.title)}</h2><p class="section-note">${escapeHTML(facts.join(' · '))}</p><p>${escapeHTML(item.overview || (loading?'Loading title details…':error?'Details are unavailable right now. You can still open the player.':'No synopsis available.'))}</p>${record&&item.type==='tv'?`<p>Last opened: season ${record.season||1}, episode ${record.episode||1}.</p>`:''}<div class="detail-actions"><button id="detailWatch" class="cinema-button primary">${record&&item.type==='tv'?'Open last episode':'Watch'}</button><button id="detailSave" class="cinema-button"></button><button id="detailShare" class="cinema-button">Copy title link</button>${randomType?'<button id="tryAgain" class="cinema-button">Try again</button>':''}${error?'<button id="retryDetails" class="cinema-button">Retry details</button>':''}</div></div></div>`;
 updateDetailSave();
 $('detailWatch').onclick=()=>openModalForCard(item);
 $('detailSave').onclick=()=>toggleSave(item.key);
 $('detailShare').onclick=()=>shareTitle(item);
 if($('tryAgain')) $('tryAgain').onclick=()=>pickForMe(randomType,item.key);
 if($('retryDetails')) $('retryDetails').onclick=()=>showDetails(item.key,randomType);
 if(focusedId)$(focusedId)?.focus();
}
async function showDetails(key, pickType = null) {
 const item=catalog.get(key);if(!item)return;
 selectedDetail=item;randomType=pickType;const version=++detailVersion;
 renderDetails(item,!item.loaded);showDialog($('detailsOverlay'));
 try { await ensureDetails(item,true); if(version===detailVersion) renderDetails(item); }
 catch { if(version===detailVersion) renderDetails(item,false,true); }
}
function hideDetails() { ++detailVersion; hideDialog($('detailsOverlay'));selectedDetail=null; }
function pickForMe(type,exclude) {
 let pool=visibleItems(type); if(pool.length>1)pool=pool.filter(i=>i.key!==exclude);
 if(pool.length)showDetails(pool[Math.floor(Math.random()*pool.length)].key,type);
}
function buildVidlinkUrl(type,id,season=1,episode=1) {
 const url=new URL(type==='tv'?`https://vidsrc.io/embed/tv/${encodeURIComponent(id)}/${season}/${episode}`:`https://vidsrc.io/embed/movie/${encodeURIComponent(id)}`);
 const progress=watched[`${type}:${id}`]?.progress?.[type==='tv'?`${season}:${episode}`:'movie'];
 if(progress && !progress.finished && Number.isFinite(progress.position) && progress.position>0)url.searchParams.set('startAt',String(Math.floor(progress.position)));
 return url.href;
}
function recordOpened() {
 if(!current)return;
 const old=watched[current.key] || {};
 watched[current.key]={...old,season:current.type==='tv'?(Number(seasonSelect.value)||1):1,episode:current.type==='tv'?(Number(episodeSelect.value)||1):1,opened:Date.now(),hiddenFromContinue:false};
 saveStore('cinema.history.v1',watched);renderItemCards(current);renderContinueWatching();
}
function playSelection() {
 if(!current)return;
 resetEpisodeOverlay();
 playbackTarget={key:current.key,season:Number(seasonSelect.value)||1,episode:Number(episodeSelect.value)||1};
 modalFrame.src=buildVidlinkUrl(current.type,current.id,playbackTarget.season,playbackTarget.episode);
 recordOpened();updateEpisodeButtons();
 $('playerStatus').textContent='Player opened. If it stays blank, try Reload player.';
}
async function getEpisodes(item,season) {
 const key=`${item.key}:${season}`;
 if(!seasonCache.has(key)) seasonCache.set(key,api(`tv/${item.id}/season/${season}`).then(d=>d.episodes||[]).catch(e=>{seasonCache.delete(key);throw e;}));
 return seasonCache.get(key);
}
async function loadEpisodes(season, desired = 1) {
 const item=current;if(!item)return;
 const version=++playerVersion;playbackTarget=null;resetEpisodeOverlay();
 seasonSelect.disabled=true;episodeSelect.disabled=true;
 $('previousEpisode').disabled=true;$('nextEpisode').disabled=true;$('markWatched').disabled=true;
 $('playerStatus').textContent='Loading episodes…';modalFrame.src='about:blank';
 try {
  const episodes=await getEpisodes(item,season);
  if(version!==playerVersion || current!==item)return;
  currentEpisodes=episodes.filter(ep=>!ep.air_date || ep.air_date<=new Date().toISOString().slice(0,10));
  episodeSelect.replaceChildren();
  for(const ep of currentEpisodes) {
   const o=document.createElement('option');o.value=ep.episode_number;o.dataset.name=`E${ep.episode_number}${ep.name?' — '+ep.name:''}`;episodeSelect.append(o);
  }
  if(!currentEpisodes.length) { $('playerStatus').textContent='No aired episodes available for this season.'; return; }
  episodeSelect.value=desired===-1?episodeSelect.options[episodeSelect.options.length-1].value:[...episodeSelect.options].some(o=>o.value===String(desired))?String(desired):episodeSelect.options[0].value;
  playSelection();
 } catch {
  if(version!==playerVersion || current!==item)return;
  currentEpisodes=[];episodeSelect.replaceChildren(new Option(`E${desired}`,String(desired)));playSelection();
  $('playerStatus').textContent='Episode details unavailable. Reload episodes to retry.';
 } finally {
  if(version===playerVersion && current===item) { seasonSelect.disabled=false;episodeSelect.disabled=!episodeSelect.options.length;updateEpisodeButtons(); }
 }
}
function updateEpisodeButtons() {
 if(!current || current.type!=='tv')return;
 const seasonIndex=seasonSelect.selectedIndex,episodeIndex=episodeSelect.selectedIndex;
 $('previousEpisode').disabled=!currentEpisodes.length || (episodeIndex<=0 && seasonIndex<=0);
 $('nextEpisode').disabled=!currentEpisodes.length || (episodeIndex>=episodeSelect.options.length-1 && seasonIndex>=seasonSelect.options.length-1);
 $('markWatched').disabled=episodeIndex<0;
 const completed=watched[current.key]?.completed || [];
 for(const option of episodeSelect.options) option.textContent=`${completed.includes(`${seasonSelect.value}:${option.value}`)?'✓ ':''}${option.dataset.name || `E${option.value}`}`;
 const marked=completed.includes(`${seasonSelect.value}:${episodeSelect.value}`);
 $('markWatched').textContent=marked?'✓ Watched':'Mark watched';$('markWatched').setAttribute('aria-pressed',String(marked));
}
async function stepEpisode(delta) {
 if(!current)return;
 const next=episodeSelect.selectedIndex+delta;
 if(next>=0 && next<episodeSelect.options.length) { episodeSelect.selectedIndex=next;playSelection();return; }
 const seasonIndex=seasonSelect.selectedIndex+delta;
 if(seasonIndex<0 || seasonIndex>=seasonSelect.options.length)return;
 seasonSelect.selectedIndex=seasonIndex;
 // A high target selects the last episode of the previous season after loading.
 await loadEpisodes(seasonSelect.value,delta<0?-1:1);
}
async function openModalForCard(item) {
 hideDetails();current=item;playbackTarget=null;resetEpisodeOverlay();const version=++playerVersion;
 $('modalTitle').textContent=item.title;$('playerStatus').textContent='Opening player…';modalFrame.src='about:blank';
 seControls.style.display=item.type==='tv'?'flex':'none';seControls.setAttribute('aria-hidden',String(item.type!=='tv'));
 showDialog(modalBackdrop);
 if(item.type==='movie'){playSelection();return;}
 seasonSelect.replaceChildren();episodeSelect.replaceChildren();seasonSelect.disabled=true;episodeSelect.disabled=true;
 $('previousEpisode').disabled=true;$('nextEpisode').disabled=true;$('markWatched').disabled=true;
 try {await ensureDetails(item,true);} catch {}
 if(current!==item || version!==playerVersion)return;
 const seasons=item.seasons?.length?item.seasons:[{season_number:1,name:'Season 1'}];
 for(const s of [...seasons].sort((a,b)=>a.season_number-b.season_number))seasonSelect.add(new Option(s.name || `Season ${s.season_number}`,String(s.season_number)));
 const previous=watched[item.key];const target=previous?.season ?? (seasons.some(s=>s.season_number===1)?1:seasons[0].season_number);
 seasonSelect.value=[...seasonSelect.options].some(o=>o.value===String(target))?String(target):seasonSelect.options[0].value;
 await loadEpisodes(seasonSelect.value,previous?.episode||1);
}
function closeModal() { ++playerVersion;current=null;playbackTarget=null;resetEpisodeOverlay();modalFrame.src='about:blank';hideDialog(modalBackdrop);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{}); }
function showUpdateLog(){showDialog($('updateLog'));}
function hideUpdateLog(){hideDialog($('updateLog'));}

function initializeCinema() {
 let theme='cyberpunk';try{theme=localStorage.getItem('theme')||theme;}catch{}changeTheme(theme,false);
 const sourceCards=[...document.querySelectorAll('button.tmdb-card')];
 sourceCards.forEach((button,order)=>{
  const type=button.dataset.type || 'movie',id=button.dataset.id,key=`${type}:${id}`;
  const item={key,type,id,title:button.getAttribute('aria-label') || 'Special',genres:(button.dataset.genres||'').split(',').map(g=>g.trim()).filter(Boolean).map(g=>g==='Science'?'Sci-Fi':g),order,special:!!button.closest('#chadGrid')};
  catalog.set(key,item);button.replaceWith(makeCard(item));
 });
 for(const type of ['movie','tv']) {
  const select=$(`${type}GenreFilter`);select.setAttribute('aria-label',`${type==='tv'?'TV':'Movie'} genre`);
  $(`${type}Search`).setAttribute('aria-label',`Search ${type==='tv'?'TV shows':'movies'}`);
  select.replaceChildren(new Option('All genres',''));
  [...new Set([...catalog.values()].filter(i=>i.type===type&&!i.special).flatMap(i=>i.genres))].sort().forEach(g=>select.add(new Option(g,g)));
  $(`${type}Sort`).onchange=()=> {filterContent(type);if(['year','rating'].includes($(`${type}Sort`).value))loadSortMetadata(type);};
 }
 // Keep episode controls within the player dialog.
 document.querySelector('.player-layout').append(seControls);
 seControls.insertAdjacentHTML('beforeend','<button id="previousEpisode" class="cinema-button">← Previous</button><button id="nextEpisode" class="cinema-button">Next →</button><button id="markWatched" class="cinema-button" aria-pressed="false">Mark watched</button><button id="reloadEpisodes" class="cinema-button">Reload episodes</button>');
 const status=document.createElement('div');status.className='player-status';status.innerHTML='<span id="playerStatus" role="status"></span><button id="reloadPlayer" class="cinema-button">Reload player</button>';
 document.querySelector('.player-layout').append(status);
 $('previousEpisode').onclick=()=>stepEpisode(-1);$('nextEpisode').onclick=()=>stepEpisode(1);
 $('reloadEpisodes').onclick=()=>{if(current){seasonCache.delete(`${current.key}:${seasonSelect.value}`);loadEpisodes(seasonSelect.value,Number(episodeSelect.value)||1);}};
 $('reloadPlayer').onclick=()=>{if(current)modalFrame.src=modalFrame.src;};
 $('markWatched').onclick=()=>{
  if(!current)return;const record=watched[current.key];if(!record)return;
  const key=`${seasonSelect.value}:${episodeSelect.value}`;const completed=record.completed||[];
  record.completed=completed.includes(key)?completed.filter(k=>k!==key):[...completed,key];
  saveStore('cinema.history.v1',watched);updateEpisodeButtons();renderContinueWatching();
 };
 seasonSelect.onchange=()=>loadEpisodes(seasonSelect.value);
 episodeSelect.onchange=playSelection;
 $('skipIntro').onclick=skipCurrentIntro;
 $('finishNextEpisode').onclick=playFinishedNextEpisode;
 $('closeBtn').onclick=closeModal;$('detailsClose').onclick=hideDetails;
 $('fullscreenBtn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('videoStage').requestFullscreen();}catch{announce('Fullscreen is unavailable in this browser.');}};
 document.addEventListener('fullscreenchange',()=>{const full=!!document.fullscreenElement;$('fullscreenLabel').textContent=full?'Exit fullscreen':'Fullscreen';$('fullscreenBtn').setAttribute('aria-pressed',String(full));});
 $('clearHistory').onclick=()=>openPopup('Clear watch history?','<p>This removes remembered episodes and watched checkmarks from this browser. Your saved list stays available.</p>',true,{text:'Clear history',action:()=>{const keys=Object.keys(watched);watched={};saveStore('cinema.history.v1',watched);keys.forEach(k=>{if(catalog.has(k))renderItemCards(catalog.get(k));});renderLibrary();renderContinueWatching();closePopup();}});
 document.addEventListener('click',event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(target.dataset.page){event.preventDefault();switchPage(target.dataset.page);}
  else if(target.dataset.resume)openModalForCard(catalog.get(target.dataset.resume));
  else if(target.dataset.dismissContinue){const key=target.dataset.dismissContinue;if(watched[key]){watched[key].hiddenFromContinue=true;saveStore('cinema.history.v1',watched);renderContinueWatching();announce('Removed from Continue Watching.');}}
  else if(target.dataset.detail)showDetails(target.dataset.detail);
  else if(target.dataset.save)toggleSave(target.dataset.save);
  else if(target.dataset.pick)pickForMe(target.dataset.pick);
  else if(target.dataset.clear)clearFilters(target.dataset.clear);
  else if(target.dataset.retry){const item=catalog.get(target.dataset.retry);item.failed=false;ensureDetails(item,true).catch(()=>announce('Artwork is still unavailable. Try again later.'));}
 });
 document.addEventListener('error',event=>{if(event.target.matches?.('.tmdb-img')){const image=event.target;image.hidden=true;const fallback=document.createElement('div');fallback.className='placeholder';fallback.textContent=catalog.get(image.closest('[data-key]')?.dataset.key)?.title || 'Poster unavailable';image.replaceWith(fallback);}},true);
 for(const [id,close] of [['modalBackdrop',closeModal],['detailsOverlay',hideDetails],['popupOverlay',closePopup],['updateLog',hideUpdateLog]])$(id).addEventListener('click',event=>{if(event.target===$(id))close();});
 document.addEventListener('keydown',event=>{
  const top=dialogs.at(-1)?.el;
  if(event.key==='Escape' && top){event.preventDefault();({modalBackdrop:closeModal,detailsOverlay:hideDetails,popupOverlay:closePopup,updateLog:hideUpdateLog}[top.id])();return;}
  if(event.key==='Tab'&&top){
   const focusRoot=document.fullscreenElement && top.contains(document.fullscreenElement)?document.fullscreenElement:top;
   const focusable=[...focusRoot.querySelectorAll('button:not([disabled]),a[href],input,select:not([disabled]),iframe,[tabindex="0"]')].filter(el=>el.getClientRects().length);
   const first=focusable[0],last=focusable.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!focusRoot.contains(document.activeElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!focusRoot.contains(document.activeElement))){event.preventDefault();first?.focus();}
  }
 });
 const keys=new Set();
 window.addEventListener('keydown',e=>{if(dialogs.length||e.target.matches('input,textarea,select,[contenteditable]'))return;keys.add(e.key.toLowerCase());if(['c','h','a','d'].every(k=>keys.has(k))){keys.clear();switchPage('chad');}});
 window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());
 window.addEventListener('popstate',()=>{switchPage(new URLSearchParams(location.search).get('view')||'movies',false);openSharedTitle();});
 window.addEventListener('message',receivePlayerProgress);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderFeatured();});
 setInterval(renderFeatured,60000);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 contentViewport.addEventListener('pointermove',event=>{
  if(reduced.matches||event.pointerType!=='mouse')return;
  const card=event.target.closest('.tmdb-card');if(!card)return;
  const r=card.getBoundingClientRect();const x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;
  card.style.transform=`perspective(900px) rotateX(${-y*8}deg) rotateY(${x*8}deg)`;
 });
 contentViewport.addEventListener('pointerout',event=>{const card=event.target.closest('.tmdb-card');if(card&&!card.contains(event.relatedTarget))card.style.transform='';});
 reduced.addEventListener('change',()=>document.querySelectorAll('.tmdb-card').forEach(c=>c.style.transform=''));
 switchPage(new URLSearchParams(location.search).get('view')||'movies',false);
 renderFeatured();
 openSharedTitle();
 if(typeof lucide!=='undefined')lucide.createIcons();
 if(!readStore('cinema.notice.v1',false))openPopup('Before you watch','<p>The embedded player may show ads or open other tabs. Close any unwanted tabs. An ad blocker may help.</p>',true,{text:'Got it',action:()=>{saveStore('cinema.notice.v1',true);closePopup();}});
}

        const tabPresets = [
            { name: "Google Classroom", icon: "https://cdn.worldvectorlogo.com/logos/google-classroom.svg" },
            { name: "Google Drive", icon: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png" },
            { name: "Schoology", icon: "https://lausdschoology.azurewebsites.net/assets/images/schoology/schoologyLogo.png" },
            { name: "Khan Academy", icon: "https://www.khanacademy.org/images/favicon.ico" },
            { name: "IXL", icon: "https://www.ixl.com/apple-touch-icon.png" },
        ];

        function cloakIcon(url) {
            document.querySelectorAll("link[rel~='icon']").forEach(link => link.remove());
            const iconUrl = (url + "").trim();
            const href = iconUrl.length === 0 ? "favicon.png" : iconUrl;

            const link = document.createElement("link");
            link.rel = "icon";
            link.type = "image/x-icon";
            link.href = href;
            document.head.appendChild(link);

            const iconInput = document.getElementById('tab-icon-input');
            if (iconInput) iconInput.value = href === "favicon.png" ? "" : href;
        }

        function cloakName(string) {
            const title = ((string + "").trim().length === 0) ? "Tinkle Party Cinema" : string;
            document.title = title;
            const titleInput = document.getElementById('tab-title-input');
            if (titleInput) titleInput.value = title === "Tinkle Party Cinema" ? "" : title;
        }

        function applyPreset(name, iconUrl) {
            cloakName(name);
            cloakIcon(iconUrl);
            setTimeout(closePopup, 300);
        }

        function openPopup(title, contentHTML, allowClose = true, actionButton = null) {
            document.getElementById('popupTitle').textContent = title;
            document.getElementById('popupBody').innerHTML = contentHTML;
            document.getElementById('popupClose').style.display = allowClose ? 'block' : 'none';
            showDialog($('popupOverlay'));

            if (actionButton) {
                const actionBtnEl = document.createElement('button');
                actionBtnEl.className = 'w-full p-3 rounded-lg font-bold bg-fuchsia-600 text-white hover:bg-fuchsia-500 mt-4 transition';
                actionBtnEl.textContent = actionButton.text;
                actionBtnEl.onclick = actionButton.action;
                document.getElementById('popupBody').appendChild(actionBtnEl);
            }
        }

        function closePopup() {
            hideDialog($('popupOverlay'));
        }

        function tabCloak() {
            const popupBody = document.getElementById('popupBody');

            const presetButtons = tabPresets.map(p => `
                <button class="w-full p-3 rounded-lg font-bold bg-gray-800 text-white hover:bg-gray-700 transition flex items-center mb-2"
                        onclick="applyPreset('${p.name.replace(/'/g, "\\'")}', '${p.icon.replace(/'/g, "\\'")}')">
                    <img src="${p.icon}" class="w-6 h-6 mr-3 rounded-full" onerror="this.src=' '">
                    ${p.name}
                </button>
            `).join('');

            const content = `
                <div class="mb-6">
                    <h4 class="text-lg font-bold text-white mb-2 border-b border-gray-700 pb-1">Quick Presets</h4>
                    ${presetButtons}
                    <button class="w-full p-3 rounded-lg font-bold bg-red-600 text-white hover:bg-red-500 transition mt-2" onclick="applyPreset('Tinkle Party Cinema', '')">
                        Reset to Default
                    </button>
                </div>

                <div class="mb-4">
                    <h4 class="text-lg font-bold text-white mb-2 border-b border-gray-700 pb-1">Custom Cloaking</h4>

                    <label for="tab-title-input" class="font-bold text-white block mb-1">Set Tab Title:</label>
                    <input type="text" id="tab-title-input" placeholder="Enter new tab name..." oninput="cloakName(this.value)" class="w-full bg-gray-800 border border-gray-700 text-white p-2 rounded-lg mb-4 outline-none">

                    <label for="tab-icon-input" class="font-bold text-white block mb-1">Set Tab Icon (URL):</label>
                    <input type="text" id="tab-icon-input" placeholder="Enter new icon URL..." oninput='cloakIcon(this.value)' class="w-full bg-gray-800 border border-gray-700 text-white p-2 rounded-lg mb-4 outline-none">
                </div>
            `;
            openPopup("Tab Cloak Settings", content);


            document.getElementById('tab-title-input').value = document.title === "Tinkle Party Cinema" ? '' : document.title;
            const currentIcon = document.querySelector("link[rel~='icon']")?.href;
            if (currentIcon && !currentIcon.endsWith('favicon.png')) {
                document.getElementById('tab-icon-input').value = currentIcon;
            }
        }

        function loadPrivacy() {
            const content = `
                <div class="max-h-96 overflow-y-auto text-gray-400">
                    <h2 class="text-xl font-bold text-white">PRIVACY POLICY</h2>
                    <p class="text-sm mb-3">Last updated September 2026</p>
                    <p class="mb-2">This policy describes how we handle your information when you use Tinkle Party Cinema.</p>

                    <h3 class="text-lg font-semibold text-white mt-4 mb-2">Data Processing</h3>
                    <p class="mb-2">We use your <strong>local browser storage</strong> (localStorage) to save your theme, watchlist, recently opened titles, selected episodes, playback progress, watched checkmarks, and notice preferences. These preferences stay in this browser. Requests to TheIntroDB (episode intro timestamps), TMDb, and the embedded video provider are sent to those services, which have their own privacy practices.</p>
                    <p class="mb-2">We use <strong>TMDb API</strong> (The Movie Database) to fetch poster images, titles, and TV season information. Catalog genres are available immediately and are refreshed when title details load.</p>
                </div>
                <button class="w-full p-3 rounded-lg font-bold bg-gray-700 text-white hover:bg-gray-600 mt-4" onclick="closePopup()">Close Policy</button>
            `;
            openPopup("Privacy Policy", content);
        }


// VidSrc event/resume contract: https://vidsrc.io/vidsrc/docs/#player-events
const PLAYER_ORIGINS = new Set(['https://vidsrc.io','https://vidsrcme.ru','https://vidsrcme.su','https://vidsrc-me.ru','https://vidsrc-me.su','https://vidsrc-embed.ru','https://vidsrc-embed.su','https://vsrc.su','https://vidsrc2.ru']);
let playbackTarget = null;
let spotlightDay = null;
function progressKey(item, season, episode) { return item.type === 'tv' ? `${season}:${episode}` : 'movie'; }
function getProgress(item, record = watched[item.key]) {
 return record?.progress?.[progressKey(item,record.season || 1,record.episode || 1)];
}
function remainingLabel(progress) {
 if (!progress || !Number.isFinite(progress.position) || !Number.isFinite(progress.duration) || progress.duration <= 0) return 'Progress unavailable';
 return `${Math.ceil(Math.max(0,progress.duration-progress.position)/60)} min left`;
}
function renderContinueWatching() {
 const entries=Object.entries(watched).filter(([key,record])=>{
  const item=catalog.get(key);if(!item || !record || record.hiddenFromContinue)return false;
  const progress=getProgress(item,record);
  return !progress?.finished && !(item.type==='tv' && record.completed?.includes(`${record.season || 1}:${record.episode || 1}`));
 }).sort((a,b)=>(b[1].opened||0)-(a[1].opened||0));
 for(const [key] of entries){const item=catalog.get(key);if(!item.loaded&&!item.failed)ensureDetails(item).catch(()=>{});}
 for (const id of ['continueMovies','continueTV']) {
  const section=$(id);if(!section)continue;
  section.hidden=!entries.length;
  const row=section.querySelector('.continue-row');
  const focused=row.contains(document.activeElement)?{key:document.activeElement.dataset.resume || document.activeElement.dataset.dismissContinue,action:document.activeElement.dataset.resume?'resume':'dismiss-continue'}:null;
  row.replaceChildren();
  for(const [key,record] of entries) {
   const item=catalog.get(key),progress=getProgress(item,record);
   const pct=progress?.duration>0?Math.min(100,Math.max(0,progress.position/progress.duration*100)):null;
   const card=document.createElement('article');card.className='continue-card';card.dataset.key=key;
   const episode=item.type==='tv'?`Season ${record.season || 1} · Episode ${record.episode || 1}`:'Movie';
   card.innerHTML=`<button class="continue-play" data-resume="${key}" aria-label="Continue ${escapeHTML(item.title)}${item.type==='tv'?`, ${episode}`:''}">${item.backdrop || item.poster?`<img src="${posterURL(item.backdrop || item.poster,'w500')}" alt="" loading="lazy">`:'<span class="continue-placeholder" aria-hidden="true">▶</span>'}<span class="continue-copy"><strong>${escapeHTML(item.title)}</strong><span>${episode}</span><span>${remainingLabel(progress)}</span></span>${pct!==null?`<span class="watch-progress" role="progressbar" aria-label="Playback progress" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></span>`:''}</button><button class="dismiss-continue" data-dismiss-continue="${key}" aria-label="Remove ${escapeHTML(item.title)} from Continue Watching">×</button>`;
   row.append(card);
  }
  if(focused) {const target=[...row.querySelectorAll(`[data-${focused.action}]`)].find(b=>b.getAttribute(`data-${focused.action}`)===focused.key);target?.focus();}
 }
}
function receivePlayerProgress(event) {
 if(!current || !playbackTarget || event.source!==modalFrame.contentWindow || !PLAYER_ORIGINS.has(event.origin))return;
 let message=event.data;
 if(typeof message==='string'){try{message=JSON.parse(message);}catch{return;}}
 if(message?.type!=='PLAYER_EVENT')return;
 const data=message.data,info=data?.player_info;
 if(!info || info.mediaType!==current.type || !['playing','paused','seeked','completed'].includes(data.player_status))return;
 const matchesID=info.tmdb!=null?String(info.tmdb)===current.id:current.imdb && info.imdb===current.imdb;
 if(!matchesID || playbackTarget.key!==current.key)return;
 if(current.type==='tv' && (Number(info.season)!==playbackTarget.season || Number(info.episode)!==playbackTarget.episode))return;
 const position=data.player_progress,duration=data.player_duration;
 if(typeof position!=='number'||typeof duration!=='number'||!Number.isFinite(position)||!Number.isFinite(duration)||position<0||duration<=0||position>duration+5)return;
 const record=watched[current.key];if(!record)return;
 const key=progressKey(current,playbackTarget.season,playbackTarget.episode);
 const finished=data.player_status==='completed' || position>=duration;
 record.progress={...record.progress,[key]:{position:Math.min(position,duration),duration,finished,updated:Date.now()}};
 record.opened=Date.now();record.hiddenFromContinue=false;
 if(current.type==='tv') {
  const completed=Array.isArray(record.completed)?record.completed:[];
  record.completed=finished?[...new Set([...completed,key])]:completed.filter(k=>k!==key);
  updateEpisodeButtons();
 }
 saveStore('cinema.history.v1',watched);
 $('playerStatus').textContent=finished?'Finished watching.':`${current.type==='tv'?`S${playbackTarget.season} · E${playbackTarget.episode} · `:''}${remainingLabel(record.progress[key])}`;
 updateEpisodeOverlay(position,duration,finished);
 renderContinueWatching();
}
function titleURL(item) {
 const url=new URL(location.href);url.search='';url.hash='';
 url.searchParams.set('view',item.type==='tv'?'tv':'movies');url.searchParams.set('title',item.key);return url.href;
}
async function shareTitle(item) {
 const url=titleURL(item);
 if(location.protocol==='file:') {openPopup('Share this title','<p>Open Cinema on your hosted website to copy a link other people can use.</p>');return;}
 try {
  await navigator.clipboard.writeText(url);
  if(selectedDetail?.key===item.key && $('detailShare'))$('detailShare').textContent='Link copied!';
  announce('Title link copied.');
 } catch {
  openPopup('Copy title link',`<p>Copy this link to share ${escapeHTML(item.title)}.</p><label for="shareURL">Title link</label><input id="shareURL" class="share-url" readonly value="${escapeHTML(url)}">`);
  requestAnimationFrame(()=>{$('shareURL').focus();$('shareURL').select();});
 }
}
function openSharedTitle() {
 const key=new URLSearchParams(location.search).get('title');if(!key)return;
 if(!catalog.has(key)){openPopup('Title unavailable','<p>This title is not in this site’s catalog. You can find another title using search.</p>');return;}
 showDetails(key);
}

// TheIntroDB v3: https://theintrodb.org/openapi.yaml (milliseconds).
const introCache = new Map();
let episodeOverlay = null;
function resetEpisodeOverlay() {
 episodeOverlay=null;
 $('skipIntro').hidden=true;$('finishNextEpisode').hidden=true;
 $('skipIntro').disabled=false;$('finishNextEpisode').disabled=false;
 $('episodeOverlayStatus').textContent='';
}
function airedEpisodes(episodes) {
 const today=new Date().toISOString().slice(0,10);
 return episodes.filter(ep=>!ep.air_date || ep.air_date<=today).sort((a,b)=>a.episode_number-b.episode_number);
}
async function findNextAiredEpisode(item, target) {
 const episodes=airedEpisodes(await getEpisodes(item,target.season));
 const next=episodes.find(ep=>ep.episode_number>target.episode);
 if(next)return {season:target.season,episode:next.episode_number};
 const seasons=(item.seasons||[]).filter(s=>s.season_number>target.season).sort((a,b)=>a.season_number-b.season_number);
 for(const season of seasons) {
  const first=airedEpisodes(await getEpisodes(item,season.season_number))[0];
  if(first)return {season:season.season_number,episode:first.episode_number};
 }
 return null;
}
async function fetchIntroSegments(item,target,duration) {
 const key=`${item.key}:${target.season}:${target.episode}:${Math.round(duration)}`;
 if(!introCache.has(key))introCache.set(key,(async()=>{
  const url=new URL('https://api.theintrodb.org/v3/media');
  url.search=new URLSearchParams({tmdb_id:item.id,season:String(target.season),episode:String(target.episode),duration_ms:String(Math.round(duration*1000))});
  const response=await fetch(url,{signal:AbortSignal.timeout(8000),credentials:'omit'});
  if(response.status===404)return [];
  if(!response.ok)throw new Error('Intro timing unavailable');
  const data=await response.json();
  if(String(data.tmdb_id)!==item.id || data.type!=='tv' || Number(data.season)!==target.season || Number(data.episode)!==target.episode)return [];
  return (Array.isArray(data.intro)?data.intro:[]).map(segment=>({start:segment.start_ms===null?0:typeof segment.start_ms==='number'?segment.start_ms/1000:NaN,end:typeof segment.end_ms==='number'?segment.end_ms/1000:NaN})).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.end<duration);
 })().catch(()=>[]));
 return introCache.get(key);
}
function updateEpisodeOverlay(position,duration,finished) {
 if(!current || current.type!=='tv' || !playbackTarget)return;
 if(!episodeOverlay || episodeOverlay.target!==playbackTarget) {
  const state={target:playbackTarget,item:current,position,duration,finished,segments:[],next:null};episodeOverlay=state;
  fetchIntroSegments(current,playbackTarget,duration).then(segments=>{if(episodeOverlay!==state)return;state.segments=segments;paintEpisodeOverlay();});
  findNextAiredEpisode(current,playbackTarget).then(next=>{if(episodeOverlay!==state)return;state.next=next;paintEpisodeOverlay();}).catch(()=>{});
 }
 Object.assign(episodeOverlay,{position,duration,finished});paintEpisodeOverlay();
}
function paintEpisodeOverlay() {
 const state=episodeOverlay;if(!state || state.target!==playbackTarget)return;
 const segment=!state.finished && state.segments.find(s=>state.position>=s.start && state.position<s.end);
 state.activeIntro=segment || null;
 $('skipIntro').hidden=!segment;
 $('finishNextEpisode').hidden=!(state.finished&&state.next);
 if(state.finished&&state.next)$('finishNextEpisode').textContent=`Next episode · S${state.next.season} E${state.next.episode} →`;
}
function skipCurrentIntro() {
 const state=episodeOverlay;
 if(!state?.activeIntro || state.target!==playbackTarget || !current)return;
 const end=Math.ceil(state.activeIntro.end);
 const url=new URL(buildVidlinkUrl(current.type,current.id,state.target.season,state.target.episode));url.searchParams.set('startAt',String(end));
 resetEpisodeOverlay();playbackTarget={...playbackTarget};
 modalFrame.src=url.href;
 $('playerStatus').textContent='Skipping intro. The player will reload; press Play if prompted.';
 $('episodeOverlayStatus').textContent='Skipping intro…';
 // Save only timestamps reported by the player, not the requested jump.
}
async function playFinishedNextEpisode() {
 const state=episodeOverlay;if(!state?.next || state.target!==playbackTarget)return;
 const {season,episode}=state.next;
 $('finishNextEpisode').disabled=true;
 seasonSelect.value=String(season);
 await loadEpisodes(season,episode);
}

initializeCinema();
