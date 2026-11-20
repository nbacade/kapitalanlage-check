'use strict';
const {chromium}=require('playwright');
const PDFDocument=require('pdfkit');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');

const dest=path.resolve('qa-live-artifacts');fs.mkdirSync(dest,{recursive:true});
const BASE='https://kapitalanlage-check-vorschau.pages.dev/berater/';
const result=[];
function record(msg){console.log('CHECK',msg);result.push(msg);}
function eq(actual,expected,label){assert.equal(actual,expected,label);record('PASS '+label+': '+actual);}
function pdfMake(fileName,lines,pages,art){
 return new Promise((ok,fail)=>{
  const target=path.join(dest,fileName);
  const d=new PDFDocument({size:'A4',margin:38,compress:false,bufferPages:false}),s=fs.createWriteStream(target);
  d.pipe(s);
  for(let n=1;n<=pages;n++){
   if(n>1)d.addPage();
   d.fillColor('#16382a').font('Helvetica').fontSize(14).text('KRAMPNITZ CARRÉ POTSDAM',{continued:false});
   d.moveDown(.7).fontSize(9.5).fillColor('#222222');
   if(n===1)for(const line of lines){d.text(line);d.moveDown(.25);}
   if(art&&[1,3,5].includes(n)){
    d.rect(45,330,490,180).fill('#b7cdbd');
    d.fillColor('#153b2a').fontSize(20).text('TESTGRAFIK – OBJEKT '+n,58,380,{lineBreak:false});
   }
   d.fillColor('#777777').fontSize(9).text('TESTDATEN – NICHT ZUR VERWENDUNG IM VERTRIEB',40,770);
  }
  d.end();s.on('finish',()=>ok(target));s.on('error',fail);
 });
}
async function visit(view,browser,files){
 let errorList=[];
 const context=await browser.newContext({viewport:{width:view.width,height:view.height},deviceScaleFactor:1,acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',e=>errorList.push(e.message));
 const mark=view.name.toUpperCase();
 const photograph=async(name)=>page.screenshot({path:path.join(dest,view.name+'-'+name+'.png'),fullPage:true,animations:'disabled',timeout:45000});
 try{
  const resp=await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:45000});
  eq(resp.status(),200,mark+' live advisor HTTP');
  await page.waitForSelector('#pdfFiles',{timeout:15000});
  await page.locator('#pdfFiles').setInputFiles(files);
  await page.waitForFunction(()=>document.getElementById('uploadLog')?.textContent?.includes('Datei(en) insgesamt'),null,{timeout:120000});
  const name=await page.locator('#name').innerText();
  assert.match(name,/Krampnitz Carr/i,'Objektname');
  record(mark+' Objektname '+name);
  const price=await page.locator('#priceView').innerText(),rent=await page.locator('#rentView').innerText(),area=await page.locator('#areaView').innerText();
  assert.match(price,/370\.000/,'Kaufpreis');assert.match(rent,/680/,'Miete');assert.match(area,/42,5/,'Fläche');
  record(mark+' 370.000 Kaufpreis / 680 Miete / 42,50 qm');
  await page.locator('#presentButton').click();
  await page.waitForSelector('body.presenting',{timeout:10000});
  record(mark+' Hauptbutton öffnet die Verkaufspräsentation');
  await page.locator('#exitPresentation').click();
  await page.waitForFunction(()=>!document.body.classList.contains('presenting'),null,{timeout:7000});
  const countSummary=await page.locator('#quickDocSummary').innerText();
  assert.match(countSummary,/1 Exposé\(s\).*1 Verkaufsdatenblatt/,'Dokumentarten richtig benannt');
  record(mark+' Dokumentenzählung '+countSummary);
  const fileCount=await page.locator('#uploadExistingTitle').innerText();
  assert.match(fileCount,/2 bereits/,'Exposé und Verkaufsdatenblatt gespeichert');
  const costs=await page.locator('#sourceExpensesTable').textContent();
  await page.locator('#sourceExpenses').evaluate(e=>e.open=true);
  record(mark+' KOSTEN '+JSON.stringify(costs).slice(0,1500));
  const detail=await page.evaluate(()=>{const o=typeof current==='function'?current():null;return {costs:o?.sourceCostBreakdown||{},sourceFiles:typeof related==='function'&&o?related(o.id).map(d=>({name:d.name,role:d.role,pages:d.pages,txt:(d.text||'').slice(0,1600)})):[]};});
  record(mark+' INTAKE '+JSON.stringify(detail).slice(0,4600));
  assert.match(costs,/24\.050/, 'Grunderwerbsteuer');assert.match(costs,/2\.590/,'Finanzierungsnotar');
  assert.match(costs,/34\.825/,'Gesamte einmalige Kosten');
  record(mark+' Kosten laut Verkaufsdatenblatt korrekt');
  await photograph('objekt-verwaltung');
  const customerCSV=[
    'Email;First;Last;Job;Capital;Net;Submitted At;Extra Info',
    'anna@example.invalid;Anna;Muster;Ärztin;100000;6500;2026-11-20;Denkmalimmobilie bevorzugt',
    'bernd@example.invalid;Bernd;Test;Zahnarzt;200000;9000;2026-11-19;Beratung nachmittags'
  ].join('\n');
  await page.locator('#customerFile').setInputFiles({name:'qa-kunden.csv',mimeType:'text/csv',buffer:Buffer.from(customerCSV)});
  await page.waitForFunction(()=>/2 Kunde\(n\) importiert/.test(document.querySelector('#customerStatus')?.textContent||''),null,{timeout:30000});
  await page.locator('[data-work="customers"]').click();
  const opts=await page.locator('#customerPicker option').evaluateAll(all=>all.filter(x=>x.value).map(x=>({value:x.value,label:x.textContent})));
  eq(opts.length,2,mark+' zwei Kunden erkannt');
  const b=opts.find(x=>x.label.includes('Bernd Test'));
  assert(b,'Testkunde Bernd Test muss auswählbar sein');
  await page.locator('#customerPicker').selectOption(b.value);
  await page.waitForFunction(()=>document.getElementById('consultationWorkName')?.textContent?.includes('Bernd Test'),null,{timeout:7000});
  assert.match(await page.locator('#customerFacts').innerText(),/Beratung nachmittags/,'Zusatzdaten angezeigt');
  record(mark+' Kundendatensatz zugeordnet');
  await photograph('kundendaten');
  await page.locator('[data-work="presentation"]').click();
  await page.waitForSelector('body.presenting',{timeout:10000});
  eq((await page.locator('#presentationClientName').innerText()).trim(),'Bernd Test',mark+' Kunde in Verkaufspräsentation');
  await page.locator('.consultation-present-details').evaluate(node=>node.open=true);
  assert.match(await page.locator('#presentationClientFacts').innerText(),/9000/,'Nettoeinkommen in Präsentation');
  const images=await page.locator('#salesImages .sales-thumb').count();
  assert(images>0,'Bilder in der Kundenpräsentation');
  const financials=await page.locator('#financeResults').innerText();
  assert.match(financials,/370\.000/,'Finanzierungsrechner verwendet 370000');
  const factsCols=await page.locator('#facts').evaluate(e=>getComputedStyle(e).gridTemplateColumns);
  record(mark+' Fakten-Raster '+factsCols);
  if(view.name==='mobile')assert.equal(factsCols.trim().split(/\s+/).length,1,'Mobil eine breite Spalte für Objektdetails');
  const modelAdmin=await page.locator('[data-live-fin="admin"]').inputValue();
  assert(!/99999/.test(modelAdmin),mark+' admin input is rounded');
  record(mark+' Hausverwaltung im Rechner '+modelAdmin);
  const displayFacts=await page.locator('#facts').textContent();
  assert.match(displayFacts,/Weitere laufende Kosten \/ Monat/,'Weitere Kosten richtig benannt');
  const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth}));
  if(overflow.scrollWidth>overflow.innerWidth+8){
    const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')].map(e=>({name:e.tagName,cls:String(e.className||'').slice(0,70),id:e.id,scroll:e.scrollWidth,right:Math.round(e.getBoundingClientRect().right)})).filter(x=>x.right>innerWidth+5).sort((a,b)=>b.right-a.right).slice(0,12));
    record(mark+' OVERFLOW ELEMENTS '+JSON.stringify(offenders));
  }
  record(mark+' Galerie '+images+' Bilder, viewport '+JSON.stringify(overflow));
  assert(overflow.scrollWidth<=overflow.innerWidth+8,mark+' ohne horizontales Überlaufen');
  await photograph('praesentation');
  if(images>0){
    await page.locator('#salesImages .sales-thumb').first().click();
    await page.waitForFunction(()=>document.querySelector('#salesLightbox')?.open,{timeout:9000});
    await page.screenshot({path:path.join(dest,view.name+'-bild-gross.png'),animations:'disabled'});
    await page.locator('#salesLightboxClose').click();
  }
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('name')?.textContent?.includes('Krampnitz'),null,{timeout:16000});
  assert.match(await page.locator('#priceView').innerText(),/370\.000/,'Daten nach Browser-Neuladen');
  record(mark+' Speicherung und Neuladen erfolgreich');
  if(errorList.length)record(mark+' Konsole: '+errorList.join(' | ').slice(0,600));
 }catch(e){
  await photograph('FEHLER').catch(()=>{});
  record('FAIL '+mark+' '+String(e.stack||e).slice(0,2200));
  throw e;
 }finally{await context.close();}
}
(async()=>{
 const exposed=await pdfMake('expose_lang_Krampnitz_Carr__Potsdam_-_WE_2_im_GG_2026-11-20.pdf',[
  'FINNISCHE ALLEE 7 | 14476 POTSDAM',
  'WE 2 IM GG | 2 ZIMMER | GG | 42,50 m²',
  'Zimmer 2',
  'Kaufpreis pro m² 8.705,88 €',
  'Kaufpreis absolut 370.000,00 €',
  'Gesamtkaufpreis 370.000,00 €',
  'Nettokaltmiete 680,00 €',
  'Baujahr 1936',
  'Jahr der Sanierung 2027',
  'Heizungsart Fernwärme',
  'Energieart Solar, Luftwärme'
 ],8,true);
 const sheet=await pdfMake('Verkaufsdatenblatt_Krampnitz_Carr__Potsdam_-_WE_2_im_GG_2026-11-20.pdf',[
  'Verkaufsdatenblatt WE 2 im GG Finnische Allee 7 14476 Potsdam',
  'Baujahr: 1936 Sanierungsjahr: 2027',
  'Vorhaben: Sanierung (§7h o. §7i EStG) mit Neubau',
  'Nutzfläche 42,50 m² Kaufpreis in EUR 370.000,00 €',
  'Energieberatung 3.375,00 €',
  '6,50 24.050,00 Grunderwerbsteuer',
  'Notar + Grundbuchkosten Erwerb 4.810,00 €',
  'Notar + Grundbuchkosten 0,70 2.590,00 € Finanzierung',
  'Sonstige nicht umlagefähige Nebenkosten 0,24 €/m² 10,00 €',
  'Verwaltungsgebühr SE 0,71 €/m² 30,00 €',
  'Verwaltungsgebühr WEG 0,71 €/m² 30,00 €',
  'Erhaltungsrücklage 0,40 €/m² 17,00 €'
 ],2,false);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let code=0;
 try{
  for(const view of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
   try{await visit(view,browser,[exposed,sheet]);}catch(e){code=1}
  }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(dest,'pruefergebnis.json'),JSON.stringify({result:code?'FAIL':'PASS',checkedAt:new Date().toISOString(),site:BASE,tests:result},null,2));
 console.log('FINAL_RESULT '+(code?'FAIL':'PASS'));
 if(code)process.exitCode=1;
})().catch(e=>{console.error('FATAL '+String(e.stack||e));process.exitCode=1;});