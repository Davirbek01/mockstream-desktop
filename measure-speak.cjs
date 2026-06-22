const { _electron } = require('@playwright/test')
;(async () => {
  const app = await _electron.launch({ args:['out/main/index.js'], env:{...process.env, MOCKSTREAM_RUNNER_URL:'http://localhost:5173'} })
  const win = await app.firstWindow()
  await win.addInitScript(()=>{
    const mk=()=>{const ac=new(window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator();o.frequency.value=180;const g=ac.createGain();g.gain.value=0.3;const d=ac.createMediaStreamDestination();o.connect(g);g.connect(d);o.start();return d.stream}
    const md=navigator.mediaDevices||{};md.getUserMedia=()=>Promise.resolve(mk());try{Object.defineProperty(navigator,'mediaDevices',{value:md,configurable:true})}catch{navigator.mediaDevices=md}
    class FR{constructor(){this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';setTimeout(()=>{this.ondataavailable&&this.ondataavailable({data:new Blob()});this.onstop&&this.onstop()},0)}static isTypeSupported(){return true}}
    window.MediaRecorder=FR
  })
  try{await win.waitForLoadState('domcontentloaded')}catch{}
  await win.goto('http://localhost:5173/speaking?exam=cefr');await win.waitForTimeout(3000)
  const href=await win.evaluate(()=>document.querySelector('a[href^="/speaking/"]')?.getAttribute('href')||null)
  await win.goto('http://localhost:5173'+href);await win.waitForTimeout(1500)
  for(let i=0;i<60;i++){
    const m=await win.evaluate(()=>{
      const imgs=[...document.querySelectorAll('[aria-label="Pictures for this question"] img')]
      const body=document.querySelector('[class*="slideBody"]')
      const speakBox=!!document.querySelector('[class*="speakBox"]')
      return { hasImg:imgs.length, speak:speakBox, imgH: imgs[0]?Math.round(imgs[0].getBoundingClientRect().height):null,
               bodyScroll: body?body.scrollHeight:null, bodyClient: body?body.clientHeight:null,
               overflow: body?body.scrollHeight-body.clientHeight:null, vh: window.innerHeight }
    })
    if(m.hasImg && m.speak){ console.log('SPEAK', JSON.stringify(m)); break }
    await win.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/start speaking|finish answer|finish exam|continue|^skip/i.test((x.textContent||'').trim()));if(b)b.click()})
    await win.waitForTimeout(900)
  }
  await app.close()
})().catch(e=>{console.error('ERR',e);process.exit(1)})
