import { Link } from "react-router";
import type { Route } from "./+types/library";
import { requireAuth } from "../lib/auth.server";

const LIBRARY_DOC_KEY = "docs/project-usage-guide.json";

type LibrarySection = {
	title: string;
	content: string;
};

type ChangelogItem = {
	version: string;
	date: string;
	summary: string;
	changes: string[];
};

type LibraryDoc = {
	title: string;
	subtitle: string;
	lastUpdated: string;
	introduction: string;
	quickStart: LibrarySection[];
	faq: LibrarySection[];
	changelog: ChangelogItem[];
};

type LoaderData = {
	doc: LibraryDoc;
	storageKey: string;
	loadedFromR2: boolean;
	note?: string;
};

function buildDefaultDoc(): LibraryDoc {
	return {
		title: "项目使用文档",
		subtitle: "集中说明常见操作、使用规范与版本更新记录。",
		lastUpdated: "2026-02-09",
		introduction:
			"本页面内容来自 R2 存储桶中的 JSON 文档。你可以把它当作团队内的变更日志与操作手册入口，优先查看最新版本记录再执行日常操作。",
		quickStart: [
			{
				title: "1) 登录与进入工作区",
				content:
					"使用账号密码登录后进入会话工作区。若是首次使用，建议先创建一个项目并在该项目下开始对话，避免不同任务上下文互相干扰。",
			},
			{
				title: "2) 新建会话并选择模型",
				content:
					"点击“新建对话”后选择合适模型。日常问答可优先轻量模型，长上下文整理或复杂推理任务建议选择更高能力模型。",
			},
			{
				title: "3) 附件与归档",
				content:
					"支持图片与文档附件（受模型与大小限制）。重要对话可在历史记录页执行“备份到 R2”，用于后续下载或审计留痕。",
			},
			{
				title: "4) 搜索与追踪",
				content:
					"侧边栏提供对话搜索，支持按当前项目或全部项目检索。建议命名对话标题时包含任务关键词，方便回溯。",
			},
		],
		faq: [
			{
				title: "为什么消息发送后看起来变慢？",
				content:
					"通常与模型响应时间、网络质量或上下文长度有关。可以尝试减少上下文消息数量，或切换到响应更快的模型。",
			},
			{
				title: "为什么附件上传失败？",
				content:
					"常见原因是文件格式不支持、单文件大小超限，或总附件体积超出限制。请压缩文件后重试。",
			},
			{
				title: "如何导出会话以便归档？",
				content:
					"在历史聊天记录页面中，可对单条会话执行“备份到 R2”后再下载。推荐在重要里程碑阶段执行一次备份。",
			},
		],
		changelog: [
			{
				version: "v1.3.0",
				date: "2026-02-09",
				summary: "新增“库/资料”页面，改为从 R2 JSON 文档加载并渲染。",
				changes: [
					"侧边栏“库/资料”入口不再跳转历史聊天记录。",
					"新增统一的项目使用文档与常见问题区块。",
					"新增 changelog 时间线，便于追踪功能演进。",
				],
			},
			{
				version: "v1.2.0",
				date: "2026-02-06",
				summary: "增强会话检索与项目管理体验。",
				changes: [
					"优化侧边栏搜索交互与结果反馈。",
					"完善项目重命名、删除等管理流程。",
				],
			},
			{
				version: "v1.1.0",
				date: "2026-02-02",
				summary: "接入 R2 归档与附件存储能力。",
				changes: [
					"支持将历史会话备份到 R2。",
					"支持从 R2 读取并访问媒体附件。",
				],
			},
		],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSafeString(value: unknown, fallback: string) {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toSectionArray(value: unknown): LibrarySection[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.map((item) => ({
			title: toSafeString(item.title, "未命名条目"),
			content: toSafeString(item.content, "暂无内容"),
		}));
}

function toChangelogArray(value: unknown): ChangelogItem[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.map((item) => ({
			version: toSafeString(item.version, "v0.0.0"),
			date: toSafeString(item.date, "未知日期"),
			summary: toSafeString(item.summary, "暂无摘要"),
			changes: Array.isArray(item.changes)
				? item.changes
						.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
						.map((entry) => entry.trim())
				: [],
		}));
}

function normalizeDoc(raw: unknown, fallback: LibraryDoc): LibraryDoc {
	if (!isRecord(raw)) return fallback;
	const normalized: LibraryDoc = {
		title: toSafeString(raw.title, fallback.title),
		subtitle: toSafeString(raw.subtitle, fallback.subtitle),
		lastUpdated: toSafeString(raw.lastUpdated, fallback.lastUpdated),
		introduction: toSafeString(raw.introduction, fallback.introduction),
		quickStart: toSectionArray(raw.quickStart),
		faq: toSectionArray(raw.faq),
		changelog: toChangelogArray(raw.changelog),
	};

	if (normalized.quickStart.length === 0) normalized.quickStart = fallback.quickStart;
	if (normalized.faq.length === 0) normalized.faq = fallback.faq;
	if (normalized.changelog.length === 0) normalized.changelog = fallback.changelog;

	return normalized;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireAuth(request, context.db);
	const fallbackDoc = buildDefaultDoc();
	const bucket = context.cloudflare.env.CHAT_ARCHIVE;
	if (!bucket) {
		return Response.json(
			{
				doc: fallbackDoc,
				storageKey: LIBRARY_DOC_KEY,
				loadedFromR2: false,
				note: "未检测到 R2 绑定，当前展示内置文档。",
			} satisfies LoaderData,
			{
				headers: {
					"Cache-Control": "private, max-age=60",
				},
			},
		);
	}

	try {
		let content = await bucket.get(LIBRARY_DOC_KEY);
		if (!content) {
			const initialText = JSON.stringify(fallbackDoc, null, 2);
			await bucket.put(LIBRARY_DOC_KEY, initialText, {
				httpMetadata: {
					contentType: "application/json; charset=utf-8",
				},
			});
			content = await bucket.get(LIBRARY_DOC_KEY);
		}

		const text = content ? await content.text() : "";
		const normalizedText = text.replace(/^\uFEFF/, "");
		const parsed = normalizedText ? (JSON.parse(normalizedText) as unknown) : null;
		const doc = normalizeDoc(parsed, fallbackDoc);
		return Response.json(
			{
				doc,
				storageKey: LIBRARY_DOC_KEY,
				loadedFromR2: true,
			} satisfies LoaderData,
			{
				headers: {
					"Cache-Control": "private, max-age=30, stale-while-revalidate=60",
				},
			},
		);
	} catch (error) {
		return Response.json(
			{
				doc: fallbackDoc,
				storageKey: LIBRARY_DOC_KEY,
				loadedFromR2: false,
				note:
					error instanceof Error
						? `读取 R2 文档失败，已回退到内置文档：${error.message}`
						: "读取 R2 文档失败，已回退到内置文档。",
			} satisfies LoaderData,
			{
				headers: {
					"Cache-Control": "private, max-age=30",
				},
			},
		);
	}
}

export default function LibraryPage({ loaderData }: Route.ComponentProps) {
	const { doc, storageKey, loadedFromR2, note } = loaderData as LoaderData;

	return (
		<div className="max-w-5xl mx-auto py-10 px-4">
			<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
						{doc.title}
					</h1>
					<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
						{doc.subtitle}
					</p>
					<p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">
						最后更新：{doc.lastUpdated}
					</p>
				</div>
				<div className="text-xs text-neutral-500 dark:text-neutral-400 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 px-3 py-2 bg-white/70 dark:bg-neutral-900/70">
					<p>文档来源：{loadedFromR2 ? "R2 存储桶" : "内置默认"}</p>
					<p className="mt-1">Key：{storageKey}</p>
				</div>
			</div>

			{note && (
				<div className="mb-6 rounded-2xl border border-amber-200/80 dark:border-amber-900/70 bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 p-4 text-sm shadow-sm">
					{note}
				</div>
			)}

			<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
				<p className="text-sm text-neutral-600 dark:text-neutral-300 leading-7">
					{doc.introduction}
				</p>
			</div>

			<section className="mt-6 rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
				<h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
					快速开始
				</h2>
				<ul className="mt-4 space-y-3">
					{doc.quickStart.map((item) => (
						<li
							key={item.title}
							className="rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 px-4 py-3 bg-white/70 dark:bg-neutral-900/50"
						>
							<div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
								{item.title}
							</div>
							<p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300 leading-6">
								{item.content}
							</p>
						</li>
					))}
				</ul>
			</section>

			<section className="mt-6 rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
				<h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
					常见问题
				</h2>
				<ul className="mt-4 space-y-3">
					{doc.faq.map((item) => (
						<li
							key={item.title}
							className="rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 px-4 py-3 bg-white/70 dark:bg-neutral-900/50"
						>
							<div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
								{item.title}
							</div>
							<p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300 leading-6">
								{item.content}
							</p>
						</li>
					))}
				</ul>
			</section>

			<section className="mt-6 rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
				<h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
					Changelog
				</h2>
				<div className="mt-4 space-y-4">
					{doc.changelog.map((item) => (
						<article
							key={`${item.version}-${item.date}`}
							className="rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 px-4 py-4 bg-white/80 dark:bg-neutral-900/60"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
									{item.version}
								</h3>
								<span className="text-xs text-neutral-500 dark:text-neutral-400">
									{item.date}
								</span>
							</div>
							<p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
								{item.summary}
							</p>
							<ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-neutral-600 dark:text-neutral-300">
								{item.changes.map((change) => (
									<li key={change}>{change}</li>
								))}
							</ul>
						</article>
					))}
				</div>
			</section>

			<div className="mt-6">
				<Link
					to="/conversations"
					className="text-sm text-brand-600 hover:text-brand-500 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 rounded-md"
				>
					返回历史聊天记录
				</Link>
			</div>
		</div>
	);
}
