// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import { DynamicBorder, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, truncateToWidth, getKeybindings, type SettingItem, type TuiMouseEvent } from "@earendil-works/pi-tui";

export interface SettingsRow {
	id: string;
	label: string;
	value: string;
	description: string;
	values?: string[];
}
export interface JobRow {
	session_id: string; cleanup_pending: boolean; ownership: string; running: boolean; buffered_bytes: number; age_seconds: number;
}
export interface JobsController {
	read(): JobRow[];
	cancel(id: string, signal: AbortSignal): Promise<void>;
}
export interface SettingsController {
	jobs?: JobsController;
	read(): Promise<SettingsRow[]>;
	change(id: string, value: string, signal: AbortSignal): Promise<string>;
	isCurrent(): boolean;
	onBoundary(close: () => void): () => void;
}
/** Native configuration can contain custom model names; never render terminal controls. */
export function settingsText(value: string): string {
	return value.replace(/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Uses Pi's real settings list; no copied widget or custom keybinding scheme. */
export class OpenAISettingsPanel extends Container {
	private readonly list: SettingsList;
	private readonly items: SettingItem[];
	private readonly feedback: Text;
	private readonly controller: SettingsController;
	private readonly requestRender: () => void;
	private readonly abort = new AbortController();
	private readonly unsubscribe: () => void;
	private readonly closeMenu: () => void;
	private rows: SettingsRow[];
	private busy = false;
	private closed = false;
	private width = 80;
	private jobsPanel?: OpenAIJobsPanel;

	constructor(rows: SettingsRow[], controller: SettingsController, theme: ExtensionContext["ui"]["theme"], requestRender: () => void, done: () => void, focus = "fast") {
		super();
		this.rows = rows; this.controller = controller; this.requestRender = requestRender;
		this.items = rows.map(row => ({ id: row.id, label: settingsText(row.label), currentValue: settingsText(row.value), description: settingsText(row.description), values: row.values?.slice(),
			submenu: row.id === "jobs" && controller.jobs ? (_value, done) => {
				if (this.closed || this.busy || this.width < 32 || !controller.isCurrent()) return new SettingsList([], 1, { label: text => text, value: text => text, description: text => text, cursor: "", hint: text => text }, () => {}, () => done());
				this.jobsPanel = new OpenAIJobsPanel(controller.jobs!, controller.isCurrent, theme, requestRender, () => {
					this.jobsPanel?.dispose(); this.jobsPanel = undefined;
					if (!this.closed) done("refresh");
				}, this.abort.signal);
				return this.jobsPanel;
			} : undefined,
		}));
		// Use the theme passed by ui.custom: jiti can have a separate SDK theme cache.
		this.list = new SettingsList(this.items, 8, {
			label: (text, selected) => selected ? theme.fg("accent", text) : text,
			value: (text, selected) => theme.fg(selected ? "accent" : "muted", text),
			description: text => theme.fg("dim", text),
			cursor: theme.fg("accent", "→ "),
			hint: text => theme.fg("dim", text.replace("Esc to cancel", "Esc to close")),
		}, (id, value) => { void this.change(id, value); }, () => this.closeMenu(), { enableSearch: true });
		this.list.selectItem(focus);
		this.feedback = new Text(theme.fg("dim", "Changes apply immediately. Tool changes cancel running capability work."), 1, 0);
		this.addChild(new DynamicBorder(text => theme.fg("border", text)));
		this.addChild(new Text(theme.fg("accent", "OpenAI settings"), 1, 0));
		this.addChild(new Text(theme.fg("muted", "Fast: saved for this profile · Tools: this session only"), 1, 0));
		this.addChild(this.list);
		this.addChild(this.feedback);
		this.addChild(new DynamicBorder(text => theme.fg("border", text)));
		this.closeMenu = () => { if (this.closed) return; this.dispose(); done(); };
		this.unsubscribe = controller.onBoundary(() => this.closeMenu());
		if (!controller.isCurrent()) queueMicrotask(() => this.closeMenu());
	}

	private update(rows: SettingsRow[]): void {
		this.rows = rows;
		for (const item of this.items) {
			const row = rows.find(row => row.id === item.id);
			item.currentValue = row ? settingsText(row.value) : "unavailable";
			item.description = row ? settingsText(row.description) : "Configuration changed. Close and reopen settings.";
			item.values = this.busy ? undefined : row?.values?.slice();
		}
	}
	private async change(id: string, value: string): Promise<void> {
		if (this.closed || this.busy) return;
		if (this.width < 32) { this.update(this.rows); return; }
		const row = this.rows.find(row => row.id === id);
		if (!row?.values?.includes(value) || !this.controller.isCurrent()) { this.closeMenu(); return; }
		this.busy = true; this.update(this.rows); // undo SettingsList's optimistic value until backend confirmation
		this.list.updateValue(id, "applying…");
		this.feedback.setText(` ${settingsText(row.label)}: applying…`); this.requestRender();
		let message: string;
		try { message = await this.controller.change(id, value, this.abort.signal); }
		catch (error) { message = `Change failed: ${settingsText(error instanceof Error ? error.message : "Unable to change setting")}`; }
		if (this.closed) return;
		try {
			const rows = await this.controller.read();
			if (this.closed || !this.controller.isCurrent()) { this.closeMenu(); return; }
			this.busy = false; this.update(rows);
			this.feedback.setText(` ${settingsText(message)}`);
		} catch {
			// Do not leave an actionable stale view if authoritative state cannot be read.
			this.busy = true;
			for (const item of this.items) { item.currentValue = "unknown"; item.values = undefined; item.description = "Current state could not be refreshed. Close and reopen settings."; }
			this.feedback.setText(" Unable to refresh settings. Close and reopen; no further changes are available.");
		}
		if (!this.closed) this.requestRender();
	}
	handleInput(data: string): void { if (!this.closed && (this.width >= 32 || getKeybindings().matches(data, "tui.select.cancel"))) this.list.handleInput(data); }
	handleMouse(event: TuiMouseEvent) { return !this.closed && event.width >= 32 ? super.handleMouse(event) : undefined; }
	render(width: number): string[] {
		this.width = width;
		if (width <= 0) return [];
		if (width < 32) return [truncateToWidth("Widen terminal for settings · Esc closes", width, "")];
		return super.render(width).map(line => truncateToWidth(line, width, ""));
	}
	dispose(): void { if (this.closed) return; this.closed = true; this.abort.abort(); this.jobsPanel?.dispose(); this.unsubscribe?.(); }
}

export async function showOpenAISettings(ctx: ExtensionContext, controller: SettingsController, focus?: string): Promise<void> {
	const rows = await controller.read();
	if (!controller.isCurrent()) return;
	await ctx.ui.custom<void>((tui, theme, _keys, done) => new OpenAISettingsPanel(rows, controller, theme, () => tui.requestRender(), () => done(), focus));
}

/** Jobs are a nested native list inside OpenAI settings, not another command/menu entry. */
export class OpenAIJobsPanel extends Container {
 private list?: SettingsList;
 private readonly feedback = new Text("Snapshot only. Enter a job for cancellation choices; Refresh updates the list.", 1, 0);
 private readonly abort = new AbortController();
 private busy = false;
 private closed = false;
 private width = 80;
 private readonly boundary = () => this.dispose();
 private readonly controller: JobsController;
 private readonly isCurrent: () => boolean;
 private readonly theme: ExtensionContext["ui"]["theme"];
 private readonly requestRender: () => void;
 private readonly done: () => void;
 private readonly parentSignal: AbortSignal;
 constructor(controller: JobsController, isCurrent: () => boolean, theme: ExtensionContext["ui"]["theme"], requestRender: () => void, done: () => void, parentSignal: AbortSignal) {
  super(); this.controller=controller;this.isCurrent=isCurrent;this.theme=theme;this.requestRender=requestRender;this.done=done;this.parentSignal=parentSignal;this.addChild(new Text(theme.fg("accent", "Unified exec jobs"), 1, 0));
  parentSignal.addEventListener("abort", this.boundary, {once:true});
  this.rebuild(); if(parentSignal.aborted) this.dispose();
 }
 private colors() { return {label:(text:string,selected:boolean)=>selected?this.theme.fg("accent",text):text,value:(text:string)=>this.theme.fg("muted",text),description:(text:string)=>this.theme.fg("dim",text),cursor:this.theme.fg("accent","→ "),hint:(text:string)=>this.theme.fg("dim",text.replace("Esc to cancel","Esc to return"))}; }
 private rebuild(): void {
  if(this.closed)return;
  let jobs:JobRow[];
  try { if(!this.isCurrent())throw Error("Context changed. Return to OpenAI settings."); jobs=this.controller.read(); }
  catch { jobs=[]; this.busy=true; this.feedback.setText(" Unable to refresh jobs. Return to OpenAI settings; no cancellation is available."); }
  const items:SettingItem[]=jobs.map((job,index)=>({id:job.session_id,label:`Job ${index+1}`,currentValue:job.cleanup_pending?"cleanup pending":job.running?"running":"completed",
   description:settingsText(`${job.session_id} · ${job.ownership} ownership · ${job.age_seconds}s old · ${job.buffered_bytes} buffered bytes. Cancellation cannot undo effects; pending cleanup requires explicit confirmation/retry.`),
   submenu:this.busy?undefined:(_value,done)=>new SettingsList([
    {id:"keep",label:"Keep job",currentValue:"return",values:["keep"],description:"Return without cancellation."},
    {id:"cancel",label:job.cleanup_pending?"Retry owned cleanup":"Cancel this job",currentValue:"confirm",values:["cancel"],description:"Stop only this owned job. Effects already performed cannot be undone. Unconfirmed cleanup stays owned."},
   ],2,this.colors(),id=>{done();if(id==="cancel")void this.cancel(job.session_id);},()=>done()),
  }));
  items.push({id:"refresh",label:"Refresh jobs",currentValue:this.busy?"unavailable":"refresh",values:this.busy?undefined:["refresh"],description:"Passive snapshot; starts no process and clears the jobs filter. Esc returns to OpenAI settings."});
  if(this.list)this.removeChild(this.list);this.removeChild(this.feedback);
  this.list=new SettingsList(items,8,this.colors(),()=>{if(!this.busy&&!this.closed&&this.width>=32){this.rebuild();this.requestRender();}},()=>this.close(),{enableSearch:true});
  this.addChild(this.list);this.addChild(this.feedback);
 }
 private async cancel(id:string):Promise<void> {
  if(this.closed||this.busy||this.width<32||!this.isCurrent())return;
  this.busy=true;this.feedback.setText(" Cancelling owned job…");this.rebuild();this.requestRender();
  try { await this.controller.cancel(id,this.abort.signal);if(!this.closed)this.feedback.setText(" Job cancelled. Snapshot refreshed; effects already performed are not undone."); }
  catch(error) { if(!this.closed)this.feedback.setText(` Cancellation failed: ${settingsText(error instanceof Error?error.message:"Cancellation unavailable")}`); }
  if(this.closed)return;this.busy=false;this.rebuild();this.requestRender();
 }
 private close():void {if(this.closed)return;this.dispose();this.done();}
 handleInput(data:string):void {if(!this.closed&&(this.width>=32||getKeybindings().matches(data,"tui.select.cancel")))this.list?.handleInput(data);}
 handleMouse(event:TuiMouseEvent){return !this.closed&&event.width>=32?super.handleMouse(event):undefined;}
 render(width:number):string[]{this.width=width;if(width<=0)return [];if(width<32)return [truncateToWidth("Widen terminal · Esc returns",width,"")];return super.render(width).map(line=>truncateToWidth(line,width,""));}
 dispose():void{if(this.closed)return;this.closed=true;this.abort.abort();this.parentSignal.removeEventListener("abort",this.boundary);}
}