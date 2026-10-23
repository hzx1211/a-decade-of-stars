// @vitest-environment jsdom
import React, {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {AnimatePresence} from "motion/react";
import {Modal, selectedBackup} from "../../components/client-utils";
import {LoginForm} from "../../components/login-form";
import {MotionScope} from "../../components/motion";
import {defaultSettings, type Asset, type Entry} from "../../lib/types";

vi.mock("next/navigation", () => ({useRouter: () => ({push: vi.fn(), refresh: vi.fn()})}));

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe("private workspace interaction boundaries",()=>{
  it("offers a read-only visitor route from the login form",()=>{
    render(React.createElement(LoginForm,{setupRequired:false,mode:"local"}));
    expect(screen.getByRole("link",{name:/以访客身份浏览/}).getAttribute("href")).toBe("/app/dashboard");
    expect(screen.getByText("仅查看已公开精选的内容")).toBeTruthy();
    expect(screen.getByRole("link",{name:"忘记密码"}).getAttribute("href")).toBe("/auth/reset-password");
  });

  it("retains the focus trap until Escape exit completes and restores the opener despite a child autoFocus",async()=>{
    const closed=vi.fn();
    function Harness() {
      const [open,setOpen]=useState(false);
      return React.createElement(React.Fragment,null,
        React.createElement("button",{onClick:()=>setOpen(true)},"打开私人记录"),
        open?React.createElement(Modal,{title:"私人记录",onClose:()=>{closed();setOpen(false);}} as React.ComponentProps<typeof Modal>,
          React.createElement("input",{autoFocus:true,"aria-label":"自动聚焦的标题"}),React.createElement("button",null,"最后一个可用控件")):null);
    }
    render(React.createElement(Harness));
    const opener=screen.getByRole("button",{name:"打开私人记录"});opener.focus();fireEvent.click(opener);
    const close=screen.getByRole("button",{name:"关闭弹窗"});const last=screen.getByRole("button",{name:"最后一个可用控件"});
    expect(document.activeElement).toBe(close);expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document,{key:"Tab",shiftKey:true});expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document,{key:"Tab"});expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document,{key:"Escape"});
    expect(screen.getByRole("dialog").closest("[data-state]")?.getAttribute("data-state")).toBe("closing");
    expect(closed).not.toHaveBeenCalled();expect(document.activeElement).toBe(close);expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document,{key:"Escape"});fireEvent.click(close);
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());expect(closed).toHaveBeenCalledTimes(1);
    await waitFor(()=>{expect(document.activeElement).toBe(opener);expect(document.body.style.overflow).toBe("");});
  });

  it("retains an externally closed modal until its own exit and scroll lock complete",async()=>{
    function Harness() {
      const [open,setOpen]=useState(false);
      return React.createElement(React.Fragment,null,
        React.createElement("button",{onClick:()=>setOpen(true)},"打开私人记录"),
        React.createElement("button",{onClick:()=>setOpen(false)},"保存并关闭"),
        React.createElement(AnimatePresence,null,open?React.createElement(Modal,{key:"record",title:"私人记录",onClose:()=>setOpen(false)} as unknown as React.ComponentProps<typeof Modal>,React.createElement("input",{"aria-label":"记录正文"})):null));
    }
    render(React.createElement(Harness));
    const opener=screen.getByRole("button",{name:"打开私人记录"});opener.focus();fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button",{name:"保存并关闭"}));
    expect(screen.getByRole("dialog").closest("[data-state]")?.getAttribute("data-state")).toBe("closing");
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(()=>{expect(document.activeElement).toBe(opener);expect(document.body.style.overflow).toBe("");});
  });

  it.each(["setting", "system"])("closes immediately when motion is disabled by the %s preference",async(preference)=>{
    if(preference==="system") vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));
    function Harness() {
      const [open,setOpen]=useState(false);
      return React.createElement(React.Fragment,null,React.createElement("button",{onClick:()=>setOpen(true)},"打开私人记录"),open?React.createElement(Modal,{title:"私人记录",onClose:()=>setOpen(false)} as React.ComponentProps<typeof Modal>,"私人正文"):null);
    }
    render(React.createElement(MotionScope,{enabled:preference!=="setting"} as React.ComponentProps<typeof MotionScope>,React.createElement(Harness)));
    const opener=screen.getByRole("button",{name:"打开私人记录"});opener.focus();fireEvent.click(opener);
    fireEvent.keyDown(document,{key:"Escape"});
    expect(screen.queryByRole("dialog")).toBeNull();expect(document.activeElement).toBe(opener);expect(document.body.style.overflow).toBe("");
  });

  it("ignores Escape, backdrop and close-button requests while the modal operation is busy",()=>{
    const closed=vi.fn();
    render(React.createElement(Modal,{title:"正在保存",onClose:closed,closeDisabled:true} as unknown as React.ComponentProps<typeof Modal>,React.createElement("button",null,"保存中")));
    const dialog=screen.getByRole("dialog"), close=screen.getByRole("button",{name:"关闭弹窗"});
    fireEvent.keyDown(document,{key:"Escape"});fireEvent.click(close);fireEvent.mouseDown(dialog.parentElement!);
    expect(closed).not.toHaveBeenCalled();expect(close.hasAttribute("disabled")).toBe(true);
    expect(dialog.closest("[data-state]")?.getAttribute("data-state")).toBe("open");expect(document.body.style.overflow).toBe("hidden");
  });

  it("selected export excludes private letter bodies, unselected media and identifying settings",()=>{
    const base={ownerId:"owner",favorite:false,createdAt:"2026-10-09T00:00:00Z",updatedAt:"2026-10-09T00:00:00Z"};
    const selected:Entry={...base,id:"selected-record",kind:"photos",title:"主动选定的原创照片",data:{assetId:"selected-image",relatedIds:["private-letter"],chapters:[]}};
    const privateLetter:Entry={...base,id:"private-letter",kind:"letters",title:"未经选择的信",data:{description:"UNSELECTED-SECRET-LETTER",assetId:"private-attachment"}};
    const media=(id:string):Asset=>({id,ownerId:"owner",filename:`${id}.png`,mimeType:"image/png",size:100,mediaType:"image",storagePath:`owner/${id}.png`,rightsStatus:"personal_only",allowedUseScope:["private_storage"],createdAt:base.createdAt});
    const result=selectedBackup({entries:[selected,privateLetter],assets:[media("selected-image"),media("private-attachment")],settings:{...defaultSettings,siteName:"PRIVATE-SITE-NAME",heroAssetId:"private-hero",featuredIds:[selected.id,privateLetter.id]}},[selected.id]);
    expect(result.entries.map(entry=>entry.id)).toEqual([selected.id]);expect(result.assets.map(asset=>asset.id)).toEqual(["selected-image"]);
    const serialized=JSON.stringify(result);
    for(const value of ["UNSELECTED-SECRET-LETTER","private-letter","private-attachment","private-hero","PRIVATE-SITE-NAME"]) expect(serialized).not.toContain(value);
  });
});
