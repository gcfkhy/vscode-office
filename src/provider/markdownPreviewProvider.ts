import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { Global } from '@/common/global';
import { getWorkspacePath } from '@/common/fileUtil';
import { TelemetryService } from '@/service/telemetryService';
import { fileTypeFromPath } from '@/service/officeViewType';
// 共享渲染器(CJS),require 形式避免 tsc 对 .js 缺类型声明报错
const { renderMarkdownToHtml } = require('../service/markdown/render');

/**
 * 只读 Markdown 预览:宿主侧用 markdown-it 渲染,Catppuccin 暗色皮肤展示。
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

        const render = () => { webview.html = this.buildHtml(webview, uri, folderPath); };
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
        }).on('externalUpdate', () => render())
            .on('fileChange', () => render());
    }

    /** 优先读已打开的文本文档(反映原生编辑器未保存的改动),否则读磁盘。 */
    private readText(uri: vscode.Uri): string {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
        if (doc) return doc.getText();
        return readFileSync(uri.fsPath, 'utf8');
    }

    private buildHtml(webview: vscode.Webview, uri: vscode.Uri, folderPath: vscode.Uri): string {
        const body: string = renderMarkdownToHtml(this.readText(uri));
        const scrollTop = this.context.globalState.get(`scrollTop_${uri.fsPath}`, 0);

        const asset = (p: string) =>
            webview.asWebviewUri(vscode.Uri.file(`${this.extensionPath}/resource/markdown/${p}`)).toString();

        const basePath = Global.getConfig('workspacePathAsImageBasePath')
            ? vscode.Uri.file(getWorkspacePath(folderPath)) : folderPath;
        const baseUrl = webview.asWebviewUri(basePath).toString()
            .replace(/\?.+$/, '').replace('https://git', 'https://file');

        const hasMermaid = /class=["']mermaid["']/.test(body);
        const mermaidScript = hasMermaid
            ? `<script src="${asset('mermaid.min.js')}"></script><script>mermaid.initialize({startOnLoad:true});</script>`
            : '';

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="${baseUrl}/">
<link rel="stylesheet" href="${asset('katex/katex.min.css')}">
<link rel="stylesheet" href="${asset('highlight/catppuccin-mocha.css')}">
<link rel="stylesheet" href="${asset('preview.css')}">
</head>
<body>
<div class="md-body">${body}</div>
<script>
(function(){
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', function(e){
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && a.getAttribute('href')) { e.preventDefault(); vscode.postMessage({type:'openLink', content:a.href}); }
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
  window.scrollTo(0, ${Number(scrollTop) || 0});
})();
</script>
${mermaidScript}
</body>
</html>`;
    }
}
