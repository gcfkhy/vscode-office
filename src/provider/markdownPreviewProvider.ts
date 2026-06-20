import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { Global } from '@/common/global';
import { getWorkspacePath } from '@/common/fileUtil';
import { TelemetryService } from '@/service/telemetryService';
import { fileTypeFromPath } from '@/service/officeViewType';
import { MarkdownService } from '@/service/markdownService';
import { MARKDOWN_THEMES, DEFAULT_THEME_ID } from './markdownThemes';
// 共享渲染器(CJS),require 形式避免 tsc 对 .js 缺类型声明报错
const { renderMarkdownToHtml } = require('../service/markdown/render');

/**
 * 只读 Markdown 预览:宿主侧用 markdown-it 渲染,可切换的调色板皮肤展示,支持主题化导出。
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

        // handler 自带的 fileChange watcher 用 fsPath 作 glob,对工作区外/Windows 路径不可靠;
        // 改用 RelativePattern 精确监听该文件,覆盖外部编辑与原子保存(写临时文件再 rename)。
        const fileName = uri.path.split('/').pop() || '*';
        const fileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folderPath, fileName));
        fileWatcher.onDidChange(() => scheduleRender());
        fileWatcher.onDidCreate(() => scheduleRender());

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
        }).on('exportPreview', (fmt: string) => {
            const themeId = this.context.globalState.get<string>('markdownPreviewTheme', DEFAULT_THEME_ID);
            new MarkdownService(this.context).exportPreview(uri, fmt, themeId);
        }).on('refresh', () => { lastText = undefined; render(); })
            .on('setZoom', (z: number) => { this.context.globalState.update('markdownPreviewZoom', typeof z === 'number' ? z : 1); })
            .on('externalUpdate', () => scheduleRender())
            .on('fileChange', () => scheduleRender())
            .on('dispose', () => { if (renderTimer) clearTimeout(renderTimer); fileWatcher.dispose(); });
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
        const savedZoom = this.context.globalState.get('markdownPreviewZoom', 1);

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

  // 缩放:Ctrl/⌘ + 滚轮 与右下角 +/- 按钮,作用于正文,全局记忆
  var ZOOM = ${savedZoom};
  var MDBODY = document.querySelector('.md-body');
  function applyZoom(){ if (MDBODY) MDBODY.style.zoom = String(ZOOM); }
  // 缩放倍数提示:正文中央短暂显示当前 %,点击可还原 100%
  var zoomTip = document.createElement('div');
  zoomTip.id = 'md-zoom-indicator'; zoomTip.title = '点击还原 100%';
  zoomTip.addEventListener('click', function(){ window.__mdSetZoom(1); });
  var zoomTipTimer;
  zoomTip.addEventListener('mouseenter', function(){ clearTimeout(zoomTipTimer); });
  zoomTip.addEventListener('mouseleave', function(){ clearTimeout(zoomTipTimer); zoomTipTimer = setTimeout(function(){ zoomTip.classList.remove('show'); }, 700); });
  if (document.body) document.body.appendChild(zoomTip);
  function showZoomTip(){
    zoomTip.textContent = Math.round(ZOOM * 100) + '%';
    zoomTip.classList.add('show');
    clearTimeout(zoomTipTimer);
    zoomTipTimer = setTimeout(function(){ zoomTip.classList.remove('show'); }, 1200);
  }
  window.__mdSetZoom = function(z){
    ZOOM = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
    applyZoom();
    showZoomTip();
    vscode.postMessage({ type: 'setZoom', content: ZOOM });
  };
  window.__mdZoomBy = function(d){ window.__mdSetZoom(ZOOM + d); };
  applyZoom();
  window.addEventListener('wheel', function(e){
    if (e.ctrlKey || e.metaKey){ e.preventDefault(); window.__mdZoomBy(e.deltaY < 0 ? 0.1 : -0.1); }
  }, { passive: false });

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

  // 主题切换
  const themeBtn = document.createElement('div');
  themeBtn.id = 'md-theme-btn'; themeBtn.textContent = '🎨'; themeBtn.title = '切换主题';
  const themePanel = document.createElement('div'); themePanel.id = 'md-theme-panel';
  function markActive(id){
    themePanel.querySelectorAll('.md-theme-item').forEach(function(el){
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
  }
  [['light','亮色'],['dark','暗色']].forEach(function(g){
    const title = document.createElement('div');
    title.className = 'md-theme-group-title'; title.textContent = g[1]; themePanel.appendChild(title);
    THEMES.filter(function(t){ return t.group === g[0]; }).forEach(function(t){
      const item = document.createElement('div');
      item.className = 'md-theme-item'; item.textContent = t.name; item.setAttribute('data-id', t.id);
      item.addEventListener('click', function(){
        document.documentElement.setAttribute('data-theme', t.id);
        markActive(t.id);
        window.__mdPost && window.__mdPost('setTheme', t.id);
        themePanel.classList.remove('open');
      });
      themePanel.appendChild(item);
    });
  });

  // 导出菜单
  const exportBtn = document.createElement('div');
  exportBtn.id = 'md-export-btn'; exportBtn.textContent = '📤'; exportBtn.title = '导出';
  const exportPanel = document.createElement('div'); exportPanel.id = 'md-export-panel';
  [['pdf','PDF'],['html','HTML'],['png','长图 (PNG)']].forEach(function(f){
    const item = document.createElement('div');
    item.className = 'md-theme-item'; item.textContent = f[1];
    item.addEventListener('click', function(){
      window.__mdPost && window.__mdPost('exportPreview', f[0]);
      exportPanel.classList.remove('open');
    });
    exportPanel.appendChild(item);
  });

  themeBtn.addEventListener('click', function(e){ e.stopPropagation(); exportPanel.classList.remove('open'); themePanel.classList.toggle('open'); });
  exportBtn.addEventListener('click', function(e){ e.stopPropagation(); themePanel.classList.remove('open'); exportPanel.classList.toggle('open'); });
  themePanel.addEventListener('click', function(e){ e.stopPropagation(); });
  exportPanel.addEventListener('click', function(e){ e.stopPropagation(); });
  document.addEventListener('click', function(){ themePanel.classList.remove('open'); exportPanel.classList.remove('open'); });

  // 手动刷新(兜底:自动刷新失败时强制重载最新内容)
  const refreshBtn = document.createElement('div');
  refreshBtn.id = 'md-refresh-btn'; refreshBtn.textContent = '🔄'; refreshBtn.title = '刷新预览';
  refreshBtn.addEventListener('click', function(e){
    e.stopPropagation();
    themePanel.classList.remove('open'); exportPanel.classList.remove('open');
    refreshBtn.classList.add('spinning');
    window.__mdPost && window.__mdPost('refresh');
  });

  // 缩放按钮:缩小 / 放大(与 Ctrl/⌘ + 滚轮同效)
  const zoomOutBtn = document.createElement('div');
  zoomOutBtn.id = 'md-zoomout-btn'; zoomOutBtn.textContent = '➖'; zoomOutBtn.title = '缩小 (Ctrl/⌘ + 滚轮)';
  zoomOutBtn.addEventListener('click', function(e){ e.stopPropagation(); themePanel.classList.remove('open'); exportPanel.classList.remove('open'); window.__mdZoomBy && window.__mdZoomBy(-0.1); });
  const zoomInBtn = document.createElement('div');
  zoomInBtn.id = 'md-zoomin-btn'; zoomInBtn.textContent = '➕'; zoomInBtn.title = '放大 (Ctrl/⌘ + 滚轮)';
  zoomInBtn.addEventListener('click', function(e){ e.stopPropagation(); themePanel.classList.remove('open'); exportPanel.classList.remove('open'); window.__mdZoomBy && window.__mdZoomBy(0.1); });

  document.body.appendChild(themeBtn); document.body.appendChild(themePanel);
  document.body.appendChild(exportBtn); document.body.appendChild(exportPanel);
  document.body.appendChild(zoomOutBtn); document.body.appendChild(zoomInBtn);
  document.body.appendChild(refreshBtn);
  markActive(CURRENT);
})();
</script>
${mermaidScript}
</body>
</html>`;
    }
}
