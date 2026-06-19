import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { Global } from '@/common/global';
import { getWorkspacePath } from '@/common/fileUtil';
import { TelemetryService } from '@/service/telemetryService';
import { fileTypeFromPath } from '@/service/officeViewType';
import { MARKDOWN_THEMES, DEFAULT_THEME_ID } from './markdownThemes';
// 共享渲染器(CJS),require 形式避免 tsc 对 .js 缺类型声明报错
const { renderMarkdownToHtml } = require('../service/markdown/render');

/**
 * 只读 Markdown 预览:宿主侧用 markdown-it 渲染,可切换的调色板皮肤展示。
 */
export class MarkdownPreviewProvider implements vscode.CustomReadonlyEditorProvider {

    private extensionPath: string;

    constructor(private context: vscode.ExtensionContext) {
        this.extensionPath = context.extensionPath;
    }

    public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose: () => { } };
    }

    public resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
        const uri = document.uri;
        const webview = panel.webview;
        const folderPath = vscode.Uri.joinPath(uri, '..');
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(this.extensionPath), folderPath],
        };

        const handler = Handler.bind(panel, uri);
        TelemetryService.get()?.trackViewOpen('markdown', fileTypeFromPath(uri.fsPath));

        let lastText: string | undefined;
        let renderTimer: ReturnType<typeof setTimeout> | undefined;
        const render = () => {
            const text = this.readText(uri);
            if (text === lastText) return;          // 内容未变则跳过,避免无谓重载
            lastText = text;
            webview.html = this.buildHtml(webview, uri, folderPath, text);
        };
        const scheduleRender = () => {
            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(render, 250);  // 编辑联动:防抖,避免逐键全量重载
        };
        render();

        handler.on('openLink', (link: string) => {
            const resReg = /https:\/\/file.*\.net/i;
            if (link && link.match(resReg)) {
                const localPath = link.replace(resReg, '');
                vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(localPath));
            } else if (link) {
                vscode.env.openExternal(vscode.Uri.parse(link));
            }
        }).on('scroll', ({ scrollTop }: { scrollTop: number }) => {
            this.context.globalState.update(`scrollTop_${uri.fsPath}`, scrollTop);
        }).on('developerTool', () => {
            vscode.commands.executeCommand('workbench.action.toggleDevTools');
        }).on('setTheme', (id: string) => {
            if (MARKDOWN_THEMES.some(t => t.id === id)) {
                this.context.globalState.update('markdownPreviewTheme', id);
            }
        }).on('externalUpdate', () => scheduleRender())
            .on('fileChange', () => scheduleRender())
            .on('dispose', () => { if (renderTimer) clearTimeout(renderTimer); });
    }

    /** 优先读已打开的文本文档(反映原生编辑器未保存的改动),否则读磁盘。 */
    private readText(uri: vscode.Uri): string {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
        if (doc) return doc.getText();
        return readFileSync(uri.fsPath, 'utf8');
    }

    private buildHtml(webview: vscode.Webview, uri: vscode.Uri, folderPath: vscode.Uri, text: string): string {
        const body: string = renderMarkdownToHtml(text);
        const scrollTop = this.context.globalState.get(`scrollTop_${uri.fsPath}`, 0);

        const savedTheme = this.context.globalState.get<string>('markdownPreviewTheme', DEFAULT_THEME_ID);
        const themeId = MARKDOWN_THEMES.some(t => t.id === savedTheme) ? savedTheme : DEFAULT_THEME_ID;
        const themesJson = JSON.stringify(MARKDOWN_THEMES);

        const asset = (p: string) =>
            webview.asWebviewUri(vscode.Uri.file(`${this.extensionPath}/resource/markdown/${p}`)).toString();

        const basePath = Global.getConfig('workspacePathAsImageBasePath')
            ? vscode.Uri.file(getWorkspacePath(folderPath)) : folderPath;
        const baseUrl = webview.asWebviewUri(basePath).toString()
            .replace(/\?.+$/, '').replace('https://git', 'https://file');

        const hasMermaid = /class=["']mermaid["']/.test(body);
        const mermaidScript = hasMermaid
            ? `<script src="${asset('mermaid.min.js')}"></script><script>mermaid.initialize({startOnLoad:false});mermaid.run();</script>`
            : '';

        return `<!DOCTYPE html>
<html data-theme="${themeId}">
<head>
<meta charset="utf-8">
<base href="${baseUrl}/">
<link rel="stylesheet" href="${asset('katex/katex.min.css')}">
<link rel="stylesheet" href="${asset('themes.css')}">
<link rel="stylesheet" href="${asset('preview.css')}">
</head>
<body>
<div class="md-body">${body}</div>
<script>
(function(){
  const vscode = acquireVsCodeApi();
  window.__mdPost = function(type, content){ vscode.postMessage({type:type, content:content}); };
  document.addEventListener('click', function(e){
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.charAt(0) === '#') return;   // 同文档锚点/TOC,交给浏览器原生滚动
    e.preventDefault();
    vscode.postMessage({type:'openLink', content:a.href});
  });
  let t;
  window.addEventListener('scroll', function(){
    clearTimeout(t);
    t = setTimeout(function(){
      const top = (document.scrollingElement || document.documentElement).scrollTop;
      vscode.postMessage({type:'scroll', content:{scrollTop: top}});
    }, 200);
  });
  window.addEventListener('keydown', function(e){ if (e.key === 'F12') vscode.postMessage({type:'developerTool'}); });
  var ST = ${Number(scrollTop) || 0};
  function restore(){ window.scrollTo(0, ST); }
  restore();
  window.addEventListener('load', restore);   // 图片/KaTeX 加载后再次校正
})();
</script>
<script>
(function(){
  const THEMES = ${themesJson};
  const CURRENT = ${JSON.stringify(themeId)};
  const btn = document.createElement('div');
  btn.id = 'md-theme-btn'; btn.textContent = '🎨'; btn.title = '切换主题';
  const panel = document.createElement('div'); panel.id = 'md-theme-panel';
  const groups = [['light','亮色'],['dark','暗色']];
  function markActive(id){
    panel.querySelectorAll('.md-theme-item').forEach(function(el){
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
  }
  groups.forEach(function(g){
    const title = document.createElement('div');
    title.className = 'md-theme-group-title'; title.textContent = g[1]; panel.appendChild(title);
    THEMES.filter(function(t){ return t.group === g[0]; }).forEach(function(t){
      const item = document.createElement('div');
      item.className = 'md-theme-item'; item.textContent = t.name; item.setAttribute('data-id', t.id);
      item.addEventListener('click', function(){
        document.documentElement.setAttribute('data-theme', t.id);
        markActive(t.id);
        window.__mdPost && window.__mdPost('setTheme', t.id);
        panel.classList.remove('open');
      });
      panel.appendChild(item);
    });
  });
  btn.addEventListener('click', function(e){ e.stopPropagation(); panel.classList.toggle('open'); });
  panel.addEventListener('click', function(e){ e.stopPropagation(); });
  document.addEventListener('click', function(){ panel.classList.remove('open'); });
  document.body.appendChild(btn); document.body.appendChild(panel);
  markActive(CURRENT);
})();
</script>
${mermaidScript}
</body>
</html>`;
    }
}
