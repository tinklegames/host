'use strict';
const $=id=>document.getElementById(id);
const TMDB_KEY='2206ab98a3adf76bf6f6cda98e32f1b0';
let connection=null,selected=null,catalogDocument=null,busy=false,searchVersion=0,searchTimer=null,searchAbort=null,results=[],activeResult=-1,publication=null,deployTimer=null;
function status(id,message,kind=''){const el=$(id);el.textContent=message;el.className=kind;}
function escapeAttribute(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function decodeContent(content){return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
function encodeContent(content){const bytes=new TextEncoder().encode(content);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
async function github(conn,path,options={}){
 const response=await fetch(`https://api.github.com/repos/${conn.repo}/${path}`,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${conn.token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(25000),credentials:'omit',cache:'no-store'});
 if(!response.ok){const error=new Error(response.status===401?'GitHub rejected this token. Check that it is valid and has not expired.':response.status===403?'GitHub denied access. Check token permissions, repository access, and rate limits.':response.status===409?'The file changed on GitHub. Click Add & publish again to retry against the latest version.':response.status===404?'GitHub could not find this resource. Check the repository, branch, and token access.':`GitHub request failed (${response.status}). Check branch rules and token permissions.`);error.status=response.status;throw error;}
 return response.status===204?null:response.json();
}
async function readCatalog(conn){
 const file=await github(conn,`contents/cinema.html?ref=${encodeURIComponent(conn.branch)}`);
 if(file.encoding!=='base64'||!file.sha||typeof file.content!=='string')throw new Error('cinema.html could not be read as a text file.');
 const source=decodeContent(file.content),doc=new DOMParser().parseFromString(source,'text/html');
 if(!doc.getElementById('movieGrid')||!doc.getElementById('tvGrid'))throw new Error('This cinema.html does not contain the expected movie and TV catalogs.');
 return {source,doc,sha:file.sha};
}
function isDuplicate(item,doc=catalogDocument){return !!(item&&doc&&doc.querySelector(`.tmdb-card[data-type="${item.type}"][data-id="${item.id}"]`));}
function refreshPublish(){
 const duplicate=isDuplicate(selected);
 $('publishButton').disabled=busy||!connection||!selected||duplicate;
 $('publishTarget').textContent=connection?`Add ${selected?`“${selected.title}”`:'a title'} to ${connection.repo} → ${connection.branch} → cinema.html.`:'Connect GitHub and select a title to continue.';
 status('duplicateStatus',duplicate?'Already in your catalog.':selected&&connection?'Ready to add.':'',duplicate?'error':'success');
}
function setBusy(value){busy=value;for(const id of ['connectButton','disconnectButton','mediaType','titleSearch'])$(id).disabled=value;refreshPublish();}
function closeResults(){results=[];activeResult=-1;$('searchResults').replaceChildren();$('searchResults').hidden=true;$('titleSearch').setAttribute('aria-expanded','false');$('titleSearch').removeAttribute('aria-activedescendant');}
function clearSelection(){selected=null;$('selection').hidden=true;refreshPublish();}
async function connect(event){
 event.preventDefault();if(busy)return;
 const repo=$('repository').value.trim(),branch=$('branch').value.trim(),token=$('githubToken').value.trim();
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!branch||!token){status('connectionStatus','Enter a repository in owner/name format, a branch, and a token.','error');return;}
 setBusy(true);status('connectionStatus','Checking repository and publishing settings…');
 const conn={repo,branch,token};
 try{
  const file=await readCatalog(conn);
  let pages=null;try{pages=await github(conn,'pages');}catch(error){if(![403,404].includes(error.status))throw error;}
  if(pages&&!(pages.source?.branch===branch&&pages.source?.path==='/'))throw new Error('This branch is not the GitHub Pages root publishing source. Choose the published branch before connecting.');
  if(pages?.build_type==='workflow')throw new Error('This repository uses a custom publishing workflow. This admin page requires GitHub Pages publishing from a branch.');
  conn.pages=pages;connection=conn;catalogDocument=file.doc;
  $('githubToken').value='';$('githubToken').disabled=true;$('repository').disabled=true;$('branch').disabled=true;$('connectButton').hidden=true;$('disconnectButton').hidden=false;$('connectionBadge').textContent='Connected';
  status('connectionStatus',pages?'Connected. Adding a title will commit the change and trigger GitHub Pages.':'Connected. Pages status is unavailable; grant Pages read access to verify publishing. Commits still trigger your configured deployment.',pages?'success':'');
 }catch(error){status('connectionStatus',error.message,'error');}finally{setBusy(false);}
}
function disconnect(){if(busy)return;connection=null;catalogDocument=null;publication=null;clearTimeout(deployTimer);$('githubToken').value='';for(const id of ['githubToken','repository','branch'])$(id).disabled=false;$('connectButton').hidden=false;$('disconnectButton').hidden=true;$('connectionBadge').textContent='Not connected';$('checkDeployment').hidden=true;$('publishLinks').replaceChildren();status('connectionStatus','Disconnected. Token cleared.');status('publishStatus','');refreshPublish();}
async function tmdb(path,signal){const url=new URL(`https://api.themoviedb.org/3/${path}`);url.searchParams.set('api_key',TMDB_KEY);url.searchParams.set('language','en-US');if(path.startsWith('search/'))url.searchParams.set('query',$('titleSearch').value.trim());const response=await fetch(url,{signal:signal||AbortSignal.timeout(15000),credentials:'omit'});if(!response.ok)throw new Error(`Title lookup failed (${response.status}). Try again.`);return response.json();}
function highlight(index){activeResult=index;const options=[...$('searchResults').children];options.forEach((el,i)=>el.setAttribute('aria-selected',String(i===index)));if(options[index]){$('titleSearch').setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});}}
async function searchTitles(version){
 searchAbort=new AbortController();const type=$('mediaType').value;
 status('searchStatus','Searching…');
 try{
  const data=await tmdb(`search/${type}`,searchAbort.signal);if(version!==searchVersion)return;
  results=(data.results||[]).filter(x=>Number.isInteger(x.id)&&x.id>0).slice(0,12);activeResult=-1;$('searchResults').replaceChildren();
  results.forEach((result,index)=>{
   const button=document.createElement('button');button.type='button';button.className='result';button.id=`result-${index}`;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.tabIndex=-1;
   if(result.poster_path){const img=document.createElement('img');img.src=`https://image.tmdb.org/t/p/w92${result.poster_path}`;img.alt='';button.append(img);}
   const text=document.createElement('span');text.append(document.createTextNode(result.title||result.name||'Untitled'));const year=document.createElement('small');year.textContent=(result.release_date||result.first_air_date||'').slice(0,4)||'Year unavailable';text.append(year);button.append(text);button.onclick=()=>selectTitle(result.id,type);$('searchResults').append(button);
  });
  $('searchResults').hidden=!results.length;$('titleSearch').setAttribute('aria-expanded',String(!!results.length));status('searchStatus',results.length?`${results.length} matches. Select the right title and year.`:'No matches. Try a different spelling.');
 }catch(error){if(version!==searchVersion||error.name==='AbortError')return;closeResults();status('searchStatus',error.message,'error');}
}
function scheduleSearch(){if(busy)return;clearTimeout(searchTimer);searchAbort?.abort();const version=++searchVersion;closeResults();clearSelection();if($('titleSearch').value.trim().length<2){status('searchStatus','Enter at least two characters.');return;}searchTimer=setTimeout(()=>searchTitles(version),300);}
async function selectTitle(id,type){
 if(busy)return;clearTimeout(searchTimer);searchAbort?.abort();const version=++searchVersion;closeResults();clearSelection();status('searchStatus','Loading title details…');
 try{
  const data=await tmdb(`${type}/${id}`);if(version!==searchVersion)return;
  const title=data.title||data.name;if(!title||data.id!==id)throw new Error('This title has incomplete metadata. Please try another result.');
  const genres=[...new Set((data.genres||[]).flatMap(g=>g.name.replace('Science Fiction','Sci-Fi').replace('Sci-Fi & Fantasy','Sci-Fi,Fantasy').replace('Action & Adventure','Action,Adventure').split(',')))];
  selected={type,id:String(id),title,genres};$('selectedTitle').textContent=title;$('selectedOverview').textContent=data.overview||'No synopsis available.';$('selectedId').textContent=id;$('selectedYear').textContent=(data.release_date||data.first_air_date||'').slice(0,4)||'Unknown';$('selectedGenres').textContent=genres.join(', ')||'No genres listed';$('selectedPoster').hidden=!data.poster_path;if(data.poster_path)$('selectedPoster').src=`https://image.tmdb.org/t/p/w342${data.poster_path}`;
  $('selection').hidden=false;$('titleSearch').value=title;status('searchStatus','Details filled in automatically.');refreshPublish();
 }catch(error){if(version===searchVersion)status('searchStatus',error.message,'error');}
}
// Insert one card without reserializing or replacing the rest of the HTML.
function insertTitle(source,item){
 const doc=new DOMParser().parseFromString(source,'text/html');if(isDuplicate(item,doc))throw new Error('This title is already in the catalog. Nothing was committed.');
 const gridId=item.type==='tv'?'tvGrid':'movieGrid';
 if(doc.querySelectorAll(`[id="${gridId}"]`).length!==1)throw new Error('Catalog structure is ambiguous. No changes were made.');
 const opening=new RegExp(`<div\\b[^>]*\\bid=["']${gridId}["'][^>]*>`,'i').exec(source);if(!opening)throw new Error('Could not locate the catalog in cinema.html.');
 const tokens=/<!--[\s\S]*?-->|<\/?div\b[^>]*>/gi;tokens.lastIndex=opening.index+opening[0].length;let depth=1,token;
 while((token=tokens.exec(source))){if(token[0].startsWith('<!--'))continue;depth+=/^<\//.test(token[0])?-1:1;if(depth===0){
  const card=`            <button class="tmdb-card" data-type="${item.type}" data-id="${item.id}" data-genres="${escapeAttribute(item.genres.join(','))}" aria-label="${escapeAttribute(item.title)}"></button>\n        `;
  return source.slice(0,token.index)+card+source.slice(token.index);
 }}throw new Error('Could not find the end of the catalog. No changes were made.');
}
function addLink(label,url){const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';$('publishLinks').append(a);}
async function publish(){
 if(busy||!connection||!selected)return;
 const conn=connection,item={...selected,genres:[...selected.genres]};setBusy(true);clearTimeout(searchTimer);searchAbort?.abort();++searchVersion;closeResults();clearTimeout(deployTimer);publication=null;$('checkDeployment').hidden=true;$('publishLinks').replaceChildren();status('publishStatus','Reading the latest catalog from GitHub…');
 try{
  const file=await readCatalog(conn);catalogDocument=file.doc;const updated=insertTitle(file.source,item);
  status('publishStatus','Committing your title…');
  const result=await github(conn,'contents/cinema.html',{method:'PUT',body:JSON.stringify({message:`Add ${item.type==='tv'?'TV show':'movie'}: ${item.title}`,branch:conn.branch,sha:file.sha,content:encodeContent(updated)})});
  catalogDocument=new DOMParser().parseFromString(updated,'text/html');
  publication={sha:result.commit.sha,started:Date.now(),conn,item};
  addLink('View commit',`https://github.com/${conn.repo}/commit/${result.commit.sha}`);
  status('publishStatus','Committed to GitHub. Waiting for the site to publish…','success');$('checkDeployment').hidden=false;
  await checkDeployment();
 }catch(error){status('publishStatus',error.name==='TimeoutError'||error instanceof TypeError?'Could not confirm the commit. Check GitHub before retrying; duplicate checks will prevent adding the same title twice.':error.message,'error');}finally{setBusy(false);}
}
async function checkDeployment(){
 const pub=publication;if(!pub||connection!==pub.conn)return;clearTimeout(deployTimer);$('checkDeployment').disabled=true;
 try{
  const build=await github(pub.conn,'pages/builds/latest');if(publication!==pub)return;
  if(build.commit===pub.sha&&build.status==='built'){
   status('publishStatus',`Published: ${pub.item.title} is live.`,'success');$('checkDeployment').hidden=true;
   const base=pub.conn.pages?.html_url;if(base){const url=new URL('cinema.html',base);url.searchParams.set('view',pub.item.type==='tv'?'tv':'movies');addLink('Open cinema',url.href);}return;
  }
  if(build.commit===pub.sha&&build.status==='errored'){status('publishStatus','The title was committed, but GitHub Pages reported a build failure. Check the repository’s Pages deployment.','error');return;}
  status('publishStatus','Committed. GitHub Pages is still publishing this change.');
  if(Date.now()-pub.started<300000)deployTimer=setTimeout(checkDeployment,10000);
  else status('publishStatus','Committed. Publishing is taking longer than usual. Use Check publishing status or inspect GitHub Pages.');
 }catch(error){if(publication!==pub)return;status('publishStatus',`Committed successfully. Publishing status could not be verified. ${error.message}`);}finally{$('checkDeployment').disabled=false;}
}
$('connectForm').addEventListener('submit',connect);$('disconnectButton').onclick=disconnect;$('titleSearch').addEventListener('input',scheduleSearch);$('mediaType').onchange=scheduleSearch;$('publishButton').onclick=publish;$('checkDeployment').onclick=checkDeployment;
$('titleSearch').addEventListener('keydown',event=>{if(event.key==='Escape'){++searchVersion;searchAbort?.abort();clearTimeout(searchTimer);closeResults();return;}if(!results.length)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();highlight((activeResult+(event.key==='ArrowDown'?1:-1)+results.length)%results.length);}else if(event.key==='Enter'&&activeResult>=0){event.preventDefault();selectTitle(results[activeResult].id,$('mediaType').value);}});
document.addEventListener('click',event=>{if(!event.target.closest('.search-area'))closeResults();});
document.addEventListener('error',event=>{if(event.target.tagName==='IMG')event.target.hidden=true;},true);
window.addEventListener('pagehide',()=>{busy=false;connection=null;publication=null;searchAbort?.abort();clearTimeout(searchTimer);$('githubToken').value='';clearTimeout(deployTimer);});
window.addEventListener('pageshow',event=>{if(event.persisted)disconnect();});
