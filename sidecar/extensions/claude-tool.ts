/**
 * claude-tool — Spawn a full Claude Code session from within the pi agent.
 *
 * Registers a `claude` tool that delegates tasks to Claude Code via the
 * @anthropic-ai/claude-agent-sdk. Claude Code has web search, file access,
 * bash, code editing, and all built-in tools. Results stream back live.
 *
 * Adapted from https://github.com/HazAT/pi-config/blob/main/extensions/claude-tool/index.ts
 * Simplified for workwithme's Tauri GUI (no TUI overlay needed).
 *
 * ## Session Persistence
 *
 * Every invocation creates a persistent Claude Code session. Pass
 * `resumeSessionId` to continue a previous session. The session ID is
 * returned in every result's details.
 *
 * ## Parallel Mode
 *
 * Pass `tasks: [{prompt, ...}, ...]` to run up to 8 Claude sessions
 * concurrently (max 3 at a time). Each result is written to its outputFile.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

// ── Constants ──
const MAX_PARALLEL_CONCURRENT = 3;
const MAX_PARALLEL_TASKS = 8;

// ── Lazy-load query from the SDK ──
let _query: typeof import("@anthropic-ai/claude-agent-sdk").query | undefined;

async function getQuery() {
	if (_query) return _query;
	// The SDK is installed at the sidecar level — import directly
	const sdk = await import("@anthropic-ai/claude-agent-sdk");
	_query = sdk.query;
	return _query;
}

// ── Helpers ──

function formatDuration(ms: number): string {
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const rem = secs % 60;
	return `${mins}m${rem.toString().padStart(2, "0")}s`;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: limit }, async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

/** Append a session record to ~/.pi/history/<project>/claude-sessions.json */
function indexSession(
	cwd: string,
	record: {
		sessionId: string;
		prompt: string;
		model?: string;
		timestamp: string;
		elapsed: number;
		cost: number;
		turns: number;
	},
) {
	try {
		const project = basename(cwd);
		const dir = join(homedir(), ".pi", "history", project);
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "claude-sessions.json");
		let sessions: any[] = [];
		try {
			sessions = JSON.parse(readFileSync(file, "utf-8"));
		} catch {}
		sessions.push(record);
		if (sessions.length > 50) sessions = sessions.slice(-50);
		writeFileSync(file, JSON.stringify(sessions, null, 2) + "\n");
	} catch {}
}

// ── Extension ──

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "claude",
		label: "Claude Code",
		description:
			`Spawn a separate Claude Code session. ONLY use when the user explicitly asks for it, or for genuinely ` +
			`complex multi-step investigations spanning many files that you cannot do yourself. ` +
			`You have read, edit, write, bash, and all other tools — use THOSE first. ` +
			`Do NOT delegate to Claude Code out of convenience or laziness. ` +
			`This tool is expensive, slow, and spins up a full separate session. ` +
			`If you can do the task with your own tools (read files, run commands, edit code, search the web), do it yourself. ` +
			`Set outputFile to write the result to a file instead of returning inline — saves tokens in your context. ` +
			`Set resumeSessionId to continue a previous session (e.g. after cancellation or for follow-up questions).`,

		promptGuidelines: [
			"Do NOT use claude as a lazy handoff — you have read, edit, write, bash, parallel_search, parallel_research, and all other tools. Use those directly.",
			"Only invoke claude when: (1) the user explicitly requests it, OR (2) the task genuinely requires autonomous multi-step execution across dozens of files that would be impractical for you to do directly.",
			"For web research, use parallel_search/parallel_research — NOT claude.",
			"For reading files, running commands, editing code, checking git status — use your own tools, NOT claude.",
			"Claude is expensive and slow. Default to doing the work yourself. When in doubt, don't use claude.",
		],

		parameters: Type.Object({
			prompt: Type.Optional(Type.String({ description: "The task or question for Claude Code (single mode)" })),
			model: Type.Optional(
				Type.String({
					description: 'Model override. Examples: "sonnet", "opus", "haiku"',
				}),
			),
			maxTurns: Type.Optional(
				Type.Number({
					description: "Maximum number of agentic turns (default: 30)",
				}),
			),
			systemPrompt: Type.Optional(
				Type.String({
					description: "Additional system prompt instructions to append",
				}),
			),
			outputFile: Type.Optional(
				Type.String({
					description:
						"Write result to this file path instead of returning inline. " +
						"Saves tokens in your context. Use when the result is large or will be consumed by a subagent.",
				}),
			),
			resumeSessionId: Type.Optional(
				Type.String({
					description:
						"Resume a previous Claude Code session by its ID. " +
						"Loads the conversation history and continues where it left off.",
				}),
			),
			tasks: Type.Optional(
				Type.Array(
					Type.Object({
						prompt: Type.String({ description: "The task or question for this Claude Code instance" }),
						model: Type.Optional(Type.String({ description: "Model override" })),
						maxTurns: Type.Optional(Type.Number({ description: "Maximum agentic turns (default: 30)" })),
						systemPrompt: Type.Optional(Type.String({ description: "Additional system prompt to append" })),
						outputFile: Type.Optional(
							Type.String({
								description:
									"File to write the result to. Auto-generated as .pi/claude-parallel-N.md if omitted.",
							}),
						),
						resumeSessionId: Type.Optional(Type.String({ description: "Resume a previous session by ID" })),
					}),
					{
						description:
							`Run multiple Claude Code sessions in parallel (max ${MAX_PARALLEL_CONCURRENT} concurrent, max ${MAX_PARALLEL_TASKS} total). ` +
							"Each result is written to its outputFile. Returns a summary of all paths and costs.",
					},
				),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const queryFn = await getQuery();

			// ── Parallel mode ──
			if (params.tasks && params.tasks.length > 0) {
				const tasks = params.tasks.slice(0, MAX_PARALLEL_TASKS);

				interface TaskResult {
					index: number;
					prompt: string;
					outputFile: string;
					success: boolean;
					cost: number;
					turns: number;
					sessionId: string;
					sessionModel: string;
					elapsed: number;
					error?: string;
				}

				const taskResults: TaskResult[] = tasks.map((t, i) => ({
					index: i,
					prompt: t.prompt,
					outputFile: t.outputFile ?? join(".pi", `claude-parallel-${i + 1}.md`),
					success: false,
					cost: 0,
					turns: 0,
					sessionId: "",
					sessionModel: "",
					elapsed: 0,
				}));

				const startTime = Date.now();

				await mapWithConcurrencyLimit(tasks, MAX_PARALLEL_CONCURRENT, async (task, index) => {
					const taskResult = taskResults[index];
					const taskStartTime = Date.now();
					let cost = 0;
					let turns = 0;
					let sessionId = "";
					let sessionModel = "";
					let fullText = "";

					const taskOptions: Record<string, any> = {
						cwd: ctx.cwd,
						maxTurns: task.maxTurns ?? 30,
						permissionMode: "bypassPermissions",
						includePartialMessages: true,
					};
					if (task.model) taskOptions.model = task.model;
					if (task.systemPrompt) taskOptions.appendSystemPrompt = task.systemPrompt;
					if (task.resumeSessionId) taskOptions.resume = task.resumeSessionId;

					try {
						for await (const message of queryFn({ prompt: task.prompt, options: taskOptions })) {
							if (signal?.aborted) break;

							if (message.type === "system" && (message as any).subtype === "init") {
								sessionId = (message as any).session_id ?? "";
								sessionModel = (message as any).model ?? "";
								continue;
							}

							if (message.type === "stream_event") {
								const delta = (message as any).event?.delta;
								if (delta?.type === "text_delta" && delta.text) {
									fullText += delta.text;
								}
								continue;
							}

							if (message.type === "result") {
								cost = (message as any).total_cost_usd ?? 0;
								turns = (message as any).num_turns ?? 0;
								if (!sessionId) sessionId = (message as any).session_id ?? "";
								if (!fullText && (message as any).result) {
									fullText = (message as any).result;
								}
							}
						}

						// Write output file
						const outPath = taskResult.outputFile;
						mkdirSync(dirname(join(ctx.cwd, outPath)), { recursive: true });
						writeFileSync(
							join(ctx.cwd, outPath),
							`# Claude Code Output\n\n**Prompt:** ${task.prompt}\n**Session:** ${sessionId}\n\n${fullText}`,
						);

						taskResult.success = true;
						taskResult.cost = cost;
						taskResult.turns = turns;
						taskResult.sessionId = sessionId;
						taskResult.sessionModel = sessionModel;
						taskResult.elapsed = Date.now() - taskStartTime;

						indexSession(ctx.cwd, {
							sessionId,
							prompt: task.prompt,
							model: sessionModel,
							timestamp: new Date().toISOString(),
							elapsed: taskResult.elapsed,
							cost,
							turns,
						});
					} catch (err: any) {
						taskResult.success = false;
						taskResult.error = err.message ?? "Unknown error";
						taskResult.elapsed = Date.now() - taskStartTime;
					}
				});

				const totalCost = taskResults.reduce((s, t) => s + t.cost, 0);
				const totalTurns = taskResults.reduce((s, t) => s + t.turns, 0);
				const successCount = taskResults.filter((t) => t.success).length;
				const elapsed = Date.now() - startTime;

				const summary = taskResults
					.map((t) =>
						t.success
							? `✓ [${t.index + 1}] ${t.outputFile} ($${t.cost.toFixed(4)}, ${t.turns} turns, ${formatDuration(t.elapsed)})`
							: `✗ [${t.index + 1}] ${t.prompt.slice(0, 60)}… — Error: ${t.error}`,
					)
					.join("\n");

				return {
					content: [
						{
							type: "text",
							text:
								`Parallel Claude Code complete: ${successCount}/${tasks.length} succeeded\n` +
								`Total cost: $${totalCost.toFixed(4)} | Total turns: ${totalTurns} | Elapsed: ${formatDuration(elapsed)}\n\n` +
								summary,
						},
					],
					details: { taskResults, totalCost, elapsed },
				};
			}

			// ── Single mode ──
			const prompt = params.prompt;
			if (!prompt) {
				return {
					content: [{ type: "text", text: "Error: either `prompt` or `tasks` is required." }],
					details: {},
					isError: true,
				};
			}

			const options: Record<string, any> = {
				cwd: ctx.cwd,
				maxTurns: params.maxTurns ?? 30,
				permissionMode: "bypassPermissions",
				includePartialMessages: true,
			};
			if (params.model) options.model = params.model;
			if (params.systemPrompt) options.appendSystemPrompt = params.systemPrompt;
			if (params.resumeSessionId) options.resume = params.resumeSessionId;

			let fullText = "";
			let cost = 0;
			let turns = 0;
			let sessionId = "";
			let sessionModel = "";
			const startTime = Date.now();

			try {
				for await (const message of queryFn({ prompt, options })) {
					if (signal?.aborted) break;

					if (message.type === "system" && (message as any).subtype === "init") {
						sessionId = (message as any).session_id ?? "";
						sessionModel = (message as any).model ?? "";
						continue;
					}

					if (message.type === "stream_event") {
						const delta = (message as any).event?.delta;
						if (delta?.type === "text_delta" && delta.text) {
							fullText += delta.text;
							(onUpdate as any)?.(fullText);
						}
						continue;
					}

					if (message.type === "assistant") {
						// Track tool use for progress (no TUI overlay, just pass through)
						continue;
					}

					if (message.type === "result") {
						cost = (message as any).total_cost_usd ?? 0;
						turns = (message as any).num_turns ?? 0;
						if (!sessionId) sessionId = (message as any).session_id ?? "";
						if (!fullText && (message as any).result) {
							fullText = (message as any).result;
						}
					}
				}
			} catch (err: any) {
				if (err.name === "AbortError" || signal?.aborted) {
					return {
						content: [{ type: "text", text: fullText || "(cancelled)" }],
						details: { cancelled: true, cost, elapsed: Date.now() - startTime, sessionId },
					};
				}
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					details: { error: err.message },
					isError: true,
				};
			}

			const elapsed = Date.now() - startTime;

			// Write output file if requested
			if (params.outputFile) {
				try {
					const outPath = join(ctx.cwd, params.outputFile);
					mkdirSync(dirname(outPath), { recursive: true });
					writeFileSync(outPath, fullText);
				} catch (err: any) {
					console.warn("[claude-tool] Failed to write output file:", err.message);
				}
			}

			// Index session for resumption
			if (sessionId) {
				indexSession(ctx.cwd, {
					sessionId,
					prompt,
					model: sessionModel,
					timestamp: new Date().toISOString(),
					elapsed,
					cost,
					turns,
				});
			}

			const footer = `\n\n---\n*Session: ${sessionId} | Cost: $${cost.toFixed(4)} | Turns: ${turns} | ${formatDuration(elapsed)}*`;

			return {
				content: [
					{
						type: "text",
						text: params.outputFile
							? `Output written to \`${params.outputFile}\`${footer}`
							: fullText + footer,
					},
				],
				details: { cost, turns, sessionId, model: sessionModel, elapsed },
			};
		},
	});
}
