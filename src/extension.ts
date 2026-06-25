import * as vscode from 'vscode';
import { TelemetryService } from './service/telemetryService';
import { JavaDecompilerProvider } from './provider/javaDecompilerProvider';
import { MarkdownPreviewProvider } from './provider/markdownPreviewProvider';
import { OfficeViewerProvider } from './provider/officeViewerProvider';
import { HtmlService } from './service/htmlService';
import { MarkdownService } from './service/markdownService';
import { FileUtil } from './common/fileUtil';
import { ReactApp } from './common/reactApp';
import { activateHttp } from './provider/http';
import { activateYaml } from './provider/yaml';
import { activateGitHistory } from './gitHistory/provider';

export function activate(context: vscode.ExtensionContext) {
	TelemetryService.init(context);
	activateHttp(context);
	activateYaml(context);
	activateGitHistory(context);
	const viewOption = { webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true } };
	// Markdown 预览自带 webview 内查找(resource/markdown/find.js,Ctrl/⌘+F)。这里必须关掉原生查找组件:
	// 否则 enableFindWidget 为 true 时 VS Code 会在宿主侧抢走 Ctrl+F 弹出自己的查找框,按键不再下发到
	// iframe,自建查找条永远收不到快捷键。两者只能留一个,见 find.js 顶部说明。
	const markdownViewOption = { webviewOptions: { retainContextWhenHidden: true, enableFindWidget: false } };
	FileUtil.init(context)
	ReactApp.init(context)
	const markdownService = new MarkdownService(context);
	markdownService.prewarmBrowser(); // 后台预取 chrome-headless-shell,失败自吞
	const viewerInstance = new OfficeViewerProvider(context);
	const markdownPreviewProvider = new MarkdownPreviewProvider(context)
	context.subscriptions.push(
		vscode.commands.registerCommand('office.markdown.switch', (uri) => { markdownService.switchEditor(uri) }),
		vscode.commands.registerCommand('office.markdown.paste', () => { markdownService.loadClipboardImage() }),
		vscode.commands.registerCommand('office.html.preview', uri => HtmlService.previewHtml(uri, context)),
		vscode.commands.registerCommand('office.markdown.export', (uri) => { markdownService.exportPick(uri) }),
		vscode.workspace.registerTextDocumentContentProvider('decompile_java', new JavaDecompilerProvider()),
		vscode.window.registerCustomEditorProvider("cweijan.markdownViewer", markdownPreviewProvider, markdownViewOption),
		vscode.window.registerCustomEditorProvider("cweijan.markdownPreview", markdownPreviewProvider, markdownViewOption),
		...viewerInstance.bindCustomEditors(viewOption)
	);
}

export function deactivate() { }