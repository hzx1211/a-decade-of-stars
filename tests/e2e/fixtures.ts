import {deflateSync} from "node:zlib";
import {expect, type APIRequestContext, type Locator} from "@playwright/test";

export const credentials = {email: "test-owner@example.test", password: "Original-stars-2026-only-tests"};
export const origin = "http://127.0.0.1:3001";
export async function expectNoUploadRightsFields(container: Locator) {
  await expect(container.getByRole("textbox", {name: /权利人|使用依据|许可类型|署名要求/})).toHaveCount(0);
  await expect(container.getByRole("combobox", {name: /授权状态|许可类型/})).toHaveCount(0);
  await expect(container.getByRole("checkbox", {name: /我确认.*依据|私人保存|私人站内播放|允许公开展示/})).toHaveCount(0);
  await expect(container.getByText("来源与使用依据", {exact: true})).toHaveCount(0);
}
export async function login(request: APIRequestContext) {
  const status = await (await request.get("/api/auth/status")).json();
  const route = status.setupRequired ? "/api/auth/setup" : "/api/auth/login";
  const result = await request.post(route, {data: credentials, headers: {Origin: origin}});
  expect(result.ok(), await result.text()).toBe(true);
}
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {crc ^= byte; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([length,type,data,crc]);
}
export function originalPng() {
  const header = Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(48,4); header[8]=8; header[9]=2;
  const scanlines = Buffer.alloc(48*(1+64*3));
  for(let y=0;y<48;y++) for(let x=0;x<64;x++) {
    const offset=y*(1+64*3)+1+x*3; scanlines[offset]=9+x; scanlines[offset+1]=21+y; scanlines[offset+2]=43+x;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(scanlines)),chunk("IEND",Buffer.alloc(0))]);
}
export function originalWav() {
  const rate=22050; const data=Buffer.alloc(rate*2); const header=Buffer.alloc(44);
  for(let i=0;i<rate;i++) data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*4000),i*2);
  header.write("RIFF"); header.writeUInt32LE(36+data.length,4); header.write("WAVE",8); header.write("fmt ",12); header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(rate,24); header.writeUInt32LE(rate*2,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34);
  header.write("data",36); header.writeUInt32LE(data.length,40); return Buffer.concat([header,data]);
}
