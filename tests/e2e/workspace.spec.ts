import {test, expect, type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {credentials, expectNoUploadRightsFields, originalPng, originalWav} from "./fixtures";

const evidenceDirectory=path.join(process.cwd(),"verification");
async function authenticate(page: Page) {
  const status=await (await page.request.get("/api/auth/status")).json();
  await page.goto("/login");
  await page.getByLabel("邮箱",{exact:true}).fill(credentials.email);
  await page.getByLabel("密码",{exact:true}).fill(credentials.password);
  await page.getByRole("button",{name:status.setupRequired?"创建我的私人纪念馆":"进入纪念馆",exact:true}).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
}
async function add(page: Page, route: string, title: string) {
  await page.goto(`/app/${route}`); await page.getByTestId("entry-create").click();
  const dialog=page.getByRole("dialog"); await dialog.getByLabel("标题",{exact:true}).fill(title); return dialog;
}
async function save(page: Page) {
  await page.getByRole("dialog").getByTestId("entry-save").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function openAdvanced(page: Page, section: "整理记录" | "媒体与来源") {
  const dialog=page.getByRole("dialog");
  const toggle=dialog.getByRole("button",{name:"更多设置",exact:true});
  if(await toggle.getAttribute("aria-expanded")==="false")await toggle.click();
  await dialog.getByRole("button",{name:section,exact:true}).click();
  return dialog;
}
async function mediaUpload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  const dialog=page.getByRole("dialog");
  const upload = dialog.getByRole("button", {name: "上传新文件", exact: true});
  if (!await upload.isVisible()) {
    const toggle = dialog.getByRole("button", {name: /添加音频|添加视频|添加照片|添加封面/});
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  }
  await upload.click();
  await expectNoUploadRightsFields(dialog);
  await dialog.getByTestId("upload-file").first().setInputFiles({name,mimeType,buffer});
  await dialog.getByTestId("upload-submit").first().click();
  await expect(dialog.getByText(`${name} 已上传，请保存当前记录以完成关联`,{exact:true})).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
}
async function originalWebm(page: Page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement("canvas"); canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext("2d")!;let frame=0;
    const draw=()=>{ctx.fillStyle="#09152b";ctx.fillRect(0,0,320,180);ctx.fillStyle="#b9ddfc";ctx.beginPath();ctx.arc(80+(frame%100),90,18,0,2*Math.PI);ctx.fill();frame++;};
    canvas.style.cssText="position:fixed;left:0;top:0;width:320px;height:180px;opacity:.01;pointer-events:none";document.body.append(canvas);
    draw(); const stream=canvas.captureStream(0); const track=stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const recorder=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp8"});
    const chunks:BlobPart[]=[]; recorder.ondataavailable=event=>chunks.push(event.data);
    const done=new Promise<Blob>(resolve=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:"video/webm"}));});
    recorder.start();track.requestFrame();const ticker=setInterval(()=>{draw();track.requestFrame();},80);await new Promise(resolve=>setTimeout(resolve,1300));clearInterval(ticker);recorder.stop();
    const blob=await done;stream.getTracks().forEach(track=>track.stop());canvas.remove();return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}
async function provePlayback(page: Page, tag: "audio"|"video") {
  const media=page.locator(tag); await expect(media).toHaveCount(1);
  await expect.poll(()=>media.evaluate(element=>(element as HTMLMediaElement).duration)).toBeGreaterThan(.6);
  await media.evaluate(async element=>{const player=element as HTMLMediaElement;player.muted=true;await player.play();});
  await expect.poll(()=>media.evaluate(element=>(element as HTMLMediaElement).currentTime)).toBeGreaterThan(.15);
  await media.evaluate(element=>{const player=element as HTMLMediaElement;player.pause();player.currentTime=.55;});
  await expect.poll(()=>media.evaluate(element=>(element as HTMLMediaElement).currentTime)).toBeGreaterThan(.5);
  expect(await media.evaluate(element=>(element as HTMLMediaElement).error)).toBeNull();
}

test("desktop/mobile real creation, uploads, playback, lightbox, privacy and selected book",async({page},testInfo)=>{
  test.setTimeout(240_000); await mkdir(evidenceDirectory,{recursive:true});
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const suffix=testInfo.project.name;
  const musicTitle=`原创一秒音调 · ${suffix}`; const photoTitle=`原创星光照片 · ${suffix}`;
  const journeyTitle=`2009 起点记录 · ${suffix}`; const journalTitle=`私人日记 · ${suffix}`; const bookTitle=`亲自选择的纪念册 · ${suffix}`;
  await authenticate(page); await noOverflow(page);
  await expect(page.getByRole("heading",{name:/张杰/,level:1})).toBeVisible();
  await page.screenshot({path:path.join(evidenceDirectory,`${suffix}-dashboard.png`),fullPage:true});

  let dialog=await add(page,"journey",journeyTitle);
  await dialog.getByLabel("年份",{exact:true}).fill("2009");
  await dialog.getByLabel("内容",{exact:true}).fill("用户确认的起始年份。此为自动测试记录，不代表真实追星经历。");
  await expect(dialog.getByLabel("标题",{exact:true})).toHaveValue(journeyTitle);
  await save(page);await expect(page.getByRole("heading",{name:journeyTitle,exact:true})).toBeVisible();

  await add(page,"music",musicTitle);await mediaUpload(page,`original-${suffix}.wav`,"audio/wav",originalWav());await save(page);
  await page.getByTestId("entry-card").filter({has:page.getByRole("button",{name:musicTitle,exact:true})}).getByRole("link",{name:"展开记忆"}).click();
  await page.getByRole("button",{name:`播放${musicTitle}`,exact:true}).click();
  await provePlayback(page,"audio");await noOverflow(page);
  await page.getByRole("button",{name:"编辑记录",exact:true}).click();
  await openAdvanced(page,"整理记录");
  await page.getByRole("dialog").getByLabel("个人笔记",{exact:true}).fill("编辑后保存仍然真实存在。");await save(page);
  await expect(page.getByText("编辑后保存仍然真实存在。",{exact:true})).toBeVisible();
  await page.screenshot({path:path.join(evidenceDirectory,`${suffix}-music-playback.png`),fullPage:true});

  await add(page,"photos",photoTitle);await mediaUpload(page,`original-${suffix}.png`,"image/png",originalPng());await save(page);
  dialog=await add(page,"photos",`${photoTitle} · 第二张`);
  await dialog.getByRole("combobox",{name:"选择素材库文件",exact:true}).selectOption({label:`original-${suffix}.png`});await save(page);
  await page.getByRole("button",{name:`在灯箱查看${photoTitle}`,exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("img",{name:photoTitle,exact:true})).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect.poll(()=>page.getByRole("dialog").getByRole("img").getAttribute("alt")).not.toBe(photoTitle);
  await page.keyboard.press("ArrowLeft");await expect(page.getByRole("dialog").getByRole("img",{name:photoTitle,exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);await noOverflow(page);
  await page.screenshot({path:path.join(evidenceDirectory,`${suffix}-photos.png`),fullPage:true});

  dialog=await add(page,"videos",`正规观看入口 · ${suffix}`);
  await openAdvanced(page,"媒体与来源");
  await dialog.getByRole("combobox",{name:"播放来源",exact:true}).selectOption("external_link");
  await dialog.getByLabel("平台链接",{exact:true}).fill("https://www.bilibili.com/");await save(page);
  const videoTitle=`原创星点短片 · ${suffix}`;
  const videoBytes=await originalWebm(page);dialog=await add(page,"videos",videoTitle);
  await mediaUpload(page,`original-${suffix}.webm`,"video/webm",videoBytes);
  await dialog.getByRole("combobox",{name:"播放来源",exact:true}).selectOption("authorized_upload");await save(page);
  await page.getByTestId("entry-card").filter({has:page.getByRole("button",{name:videoTitle,exact:true})}).getByRole("link",{name:"展开记忆"}).click();
  await provePlayback(page,"video");await noOverflow(page);
  await page.screenshot({path:path.join(evidenceDirectory,`${suffix}-video-playback.png`),fullPage:true});

  dialog=await add(page,"journal",journalTitle);await dialog.getByLabel("正文",{exact:true}).fill(`PRIVATE-UNSELECTED-${suffix}`);await save(page);await page.reload();
  await page.getByLabel("搜索记录",{exact:true}).fill(journalTitle);await expect(page.getByRole("button",{name:journalTitle,exact:true})).toBeVisible();
  await page.goto("/app/search");await page.getByLabel("搜索记录",{exact:true}).fill(journalTitle);await expect(page.getByRole("button",{name:journalTitle,exact:true})).toBeVisible();

  dialog=await add(page,"memory-book",bookTitle);
  await dialog.getByRole("button",{name:/选择纪念册内容/}).click();
  await dialog.getByRole("checkbox",{name:`${photoTitle} 照片馆`,exact:true}).check();
  await dialog.getByRole("checkbox",{name:`${journeyTitle} 十余年星途`,exact:true}).check();await save(page);
  await page.getByTestId("entry-card").filter({has:page.getByRole("button",{name:bookTitle,exact:true})}).getByRole("button",{name:"纸张预览"}).click();
  await expect(page.locator(".ws-print-root").getByRole("heading",{name:photoTitle,exact:true})).toBeVisible();
  await expect(page.locator(".ws-print-root").getByText(`PRIVATE-UNSELECTED-${suffix}`,{exact:true})).toHaveCount(0);
  await page.screenshot({path:path.join(evidenceDirectory,`${suffix}-memory-book.png`),fullPage:true});
  if(suffix==="desktop") {
    const pdf=await page.pdf({path:path.join(evidenceDirectory,"selected-memory-book.pdf"),printBackground:true,preferCSSPageSize:true});
    expect(pdf.subarray(0,4).toString()).toBe("%PDF");expect(pdf.length).toBeGreaterThan(2000);
  }
  await page.keyboard.press("Escape");
  await page.context().clearCookies();await page.goto("/app/journal");await expect(page).toHaveURL(/\/app\/journal/);
  await expect(page.getByTestId("entry-create")).toHaveCount(0);
  expect(await page.content()).not.toContain(`PRIVATE-UNSELECTED-${suffix}`);
  expect(errors).toEqual([]);
});
