<script lang="ts">
	import View from "#lib/View.svelte";
	import {
		MAX_PROJECTS,
		MAX_NAME_CHARS,
		cleanName,
		projectStore,
		type Project,
	} from "#lib/projects.js";
	import {
		MAX_INSTRUCTIONS,
		MAX_PROJECT_FILES,
		cleanProjectPath,
		parseDetail,
		type ProjectDetail,
		type ProjectFile,
	} from "#lib/projects_extra.js";
	import { onMount } from "svelte";
	import { useMutation, useQuery, useAuth } from "convex-svelte";
	import { env } from "$env/dynamic/public";
	import { api } from "../../convex/_generated/api.js";
	import type { Id } from "../../convex/_generated/dataModel.js";

	type CloudProjectRow = {
		_id: Id<"projects">;
		name: string;
		instructions?: string;
		files?: ProjectFile[];
		createdAt: number;
	};

	const LOCAL_DETAILS_KEY = "codex-web:project-details:v1";

	const cloudUrl = env.PUBLIC_CONVEX_URL;
	const auth = cloudUrl ? useAuth() : null;
	const isCloud = $derived(Boolean(cloudUrl) && auth?.isAuthenticated === true);

	const listQuery = cloudUrl
		? useQuery(api.projects.list, () => (auth?.isAuthenticated ? {} : "skip"))
		: null;
	const createMutation = cloudUrl ? useMutation(api.projects.create) : null;
	const renameMutation = cloudUrl ? useMutation(api.projects.rename) : null;
	const removeMutation = cloudUrl ? useMutation(api.projects.remove) : null;
	const setDetailMutation = cloudUrl ? useMutation(api.projects.setDetail) : null;

	let localProjects = $state<Project[]>([]);
	let selectedProjectId = $state<string | null>(null);

	let newProjectName = $state("");
	let renameDraft = $state("");
	let instructionsDraft = $state("");
	let filesDraft = $state<ProjectFile[]>([]);

	let newFilePath = $state("");
	let newFileBytes = $state<number>(0);

	let error = $state("");
	let notice = $state("");

	function readLocalDetails(): Record<string, ProjectDetail> {
		try {
			if (typeof localStorage === "undefined") return {};
			const raw = localStorage.getItem(LOCAL_DETAILS_KEY);
			if (!raw) return {};
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
			const out: Record<string, ProjectDetail> = {};
			for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
				const detail = parseDetail(val);
				if (detail) out[id] = detail;
			}
			return out;
		} catch {
			return {};
		}
	}

	function writeLocalDetail(id: string, detail: ProjectDetail): void {
		try {
			if (typeof localStorage === "undefined") return;
			const map = readLocalDetails();
			map[id] = detail;
			localStorage.setItem(LOCAL_DETAILS_KEY, JSON.stringify(map));
		} catch {
			// storage quota ignored
		}
	}

	function removeLocalDetail(id: string): void {
		try {
			if (typeof localStorage === "undefined") return;
			const map = readLocalDetails();
			delete map[id];
			localStorage.setItem(LOCAL_DETAILS_KEY, JSON.stringify(map));
		} catch {
			// storage quota ignored
		}
	}

	onMount(() => {
		localProjects = projectStore.projects();
	});

	const cloudProjects = $derived(((listQuery?.data ?? []) as CloudProjectRow[]) || []);

	type UnifiedProject = {
		id: string;
		name: string;
		createdAt: number;
		instructions?: string;
		files?: ProjectFile[];
	};

	const allProjects = $derived<UnifiedProject[]>(
		isCloud
			? cloudProjects.map((p) => ({
					id: p._id,
					name: p.name,
					createdAt: p.createdAt,
					instructions: p.instructions,
					files: p.files,
				}))
			: localProjects.map((p) => ({
					id: p.id,
					name: p.name,
					createdAt: p.createdAt,
				})),
	);

	const selectedProject = $derived(
		allProjects.find((p) => p.id === selectedProjectId) ?? null,
	);

	function selectProject(id: string) {
		selectedProjectId = id;
		error = "";
		notice = "";
		newFilePath = "";
		newFileBytes = 0;

		const proj = allProjects.find((p) => p.id === id);
		if (!proj) return;

		renameDraft = proj.name;
		if (isCloud) {
			const cloudItem = cloudProjects.find((p) => p._id === id);
			const detail = parseDetail(cloudItem) ?? { instructions: "", files: [] };
			instructionsDraft = detail.instructions;
			filesDraft = [...detail.files];
		} else {
			const localMap = readLocalDetails();
			const detail = parseDetail(localMap[id]) ?? { instructions: "", files: [] };
			instructionsDraft = detail.instructions;
			filesDraft = [...detail.files];
		}
	}

	async function createProject() {
		error = "";
		notice = "";
		const clean = cleanName(newProjectName);
		if (!clean) {
			error = `Project name must be 1 to ${MAX_NAME_CHARS} characters.`;
			return;
		}
		if (allProjects.length >= MAX_PROJECTS) {
			error = `Maximum of ${MAX_PROJECTS} projects reached.`;
			return;
		}

		if (isCloud && createMutation) {
			try {
				const id = await createMutation({ name: clean });
				newProjectName = "";
				notice = "Project created.";
				selectProject(id);
			} catch (e: unknown) {
				const err = e as { data?: { message?: string }; message?: string };
				error = err?.data?.message ?? err?.message ?? "Could not create project.";
			}
		} else {
			const created = projectStore.create(clean);
			if (created) {
				newProjectName = "";
				localProjects = projectStore.projects();
				notice = "Project created.";
				selectProject(created.id);
			} else {
				error = `Could not create project. Ensure name is 1 to ${MAX_NAME_CHARS} characters.`;
			}
		}
	}

	async function renameCurrentProject() {
		if (!selectedProjectId) return;
		error = "";
		notice = "";
		const clean = cleanName(renameDraft);
		if (!clean) {
			error = `Project name must be 1 to ${MAX_NAME_CHARS} characters.`;
			return;
		}
		if (isCloud && renameMutation) {
			try {
				await renameMutation({
					id: selectedProjectId as Id<"projects">,
					name: clean,
				});
				notice = "Project renamed.";
			} catch (e: unknown) {
				const err = e as { data?: { message?: string }; message?: string };
				error = err?.data?.message ?? err?.message ?? "Could not rename project.";
			}
		} else {
			if (projectStore.rename(selectedProjectId, clean)) {
				localProjects = projectStore.projects();
				notice = "Project renamed.";
			} else {
				error = "Could not rename project.";
			}
		}
	}

	async function removeCurrentProject() {
		if (!selectedProjectId) return;
		const name = selectedProject?.name ?? "this project";
		if (!confirm(`Delete project "${name}"? This cannot be undone.`)) {
			return;
		}
		error = "";
		notice = "";
		const targetId = selectedProjectId;
		if (isCloud && removeMutation) {
			try {
				await removeMutation({ id: targetId as Id<"projects"> });
				selectedProjectId = null;
				notice = "Project deleted.";
			} catch (e: unknown) {
				const err = e as { data?: { message?: string }; message?: string };
				error = err?.data?.message ?? err?.message ?? "Could not delete project.";
			}
		} else {
			if (projectStore.remove(targetId)) {
				removeLocalDetail(targetId);
				localProjects = projectStore.projects();
				selectedProjectId = null;
				notice = "Project deleted.";
			} else {
				error = "Could not delete project.";
			}
		}
	}

	function addFile() {
		error = "";
		notice = "";
		const clean = cleanProjectPath(newFilePath);
		if (!clean) {
			error = "File path must be a relative path (1–300 chars, no leading slash, no '..' segment).";
			return;
		}
		const bytes = Math.floor(newFileBytes);
		if (!Number.isFinite(bytes) || bytes < 0) {
			error = "File size must be a non-negative integer.";
			return;
		}
		if (filesDraft.length >= MAX_PROJECT_FILES) {
			error = `Maximum of ${MAX_PROJECT_FILES} file labels reached for this project.`;
			return;
		}
		if (filesDraft.some((f) => f.path === clean)) {
			error = `A file labeled '${clean}' is already in this project.`;
			return;
		}
		filesDraft = [...filesDraft, { path: clean, bytes }];
		newFilePath = "";
		newFileBytes = 0;
	}

	function removeFile(path: string) {
		filesDraft = filesDraft.filter((f) => f.path !== path);
	}

	async function saveDetail() {
		if (!selectedProjectId) return;
		error = "";
		notice = "";
		if (instructionsDraft.length > MAX_INSTRUCTIONS) {
			error = `Instructions cannot exceed ${MAX_INSTRUCTIONS} characters.`;
			return;
		}
		if (filesDraft.length > MAX_PROJECT_FILES) {
			error = `Maximum ${MAX_PROJECT_FILES} files allowed.`;
			return;
		}

		if (isCloud && setDetailMutation) {
			try {
				await setDetailMutation({
					id: selectedProjectId as Id<"projects">,
					instructions: instructionsDraft,
					files: filesDraft,
				});
				notice = "Project details saved.";
			} catch (e: unknown) {
				const err = e as { data?: { message?: string }; message?: string };
				error = err?.data?.message ?? err?.message ?? "Could not save project details.";
			}
		} else {
			writeLocalDetail(selectedProjectId, {
				instructions: instructionsDraft,
				files: filesDraft,
			});
			notice = "Project details saved.";
		}
	}
</script>

<View
	title="Projects"
	icon="folder"
	subtitle="Projects group chat sessions and provide instructions and file labels as untrusted turn context."
>
	{#snippet actions()}
		<span class="chip mono">{allProjects.length} of {MAX_PROJECTS}</span>
	{/snippet}

	<p class="mb-4 text-[12.5px] leading-relaxed text-ink-2" role="status">
		{#if isCloud}
			Stored on your Convex deployment
		{:else}
			Stored in this browser only
		{/if}
	</p>

	{#if error}
		<p class="mb-4 text-[12px] text-red-400" role="alert">{error}</p>
	{/if}
	{#if notice}
		<p class="mb-4 text-[12px] text-ink-2" role="status">{notice}</p>
	{/if}

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
		<section class="card p-4 lg:col-span-5">
			<h2 class="mb-3 text-[14px] font-medium text-ink">Projects</h2>

			<div class="mb-4 flex flex-col gap-2">
				<label for="new-project-name" class="text-[12px] text-ink-2">
					Create project
				</label>
				<div class="flex gap-2">
					<input
						id="new-project-name"
						type="text"
						class="field flex-1 text-[13px]"
						placeholder="New project name"
						maxlength={MAX_NAME_CHARS}
						bind:value={newProjectName}
					/>
					<button
						type="button"
						class="btn btn-solid shrink-0"
						disabled={!newProjectName.trim()}
						onclick={createProject}
					>
						Create
					</button>
				</div>
			</div>

			<div class="border-t border-line pt-3">
				<span class="mb-2 block text-[11.5px] uppercase tracking-wider text-ink-3">
					Project list
				</span>
				{#if allProjects.length === 0}
					<p class="py-4 text-[12.5px] text-ink-3" role="status">
						No projects yet. Create one above to get started.
					</p>
				{:else}
					<ul class="flex flex-col gap-1">
						{#each allProjects as project (project.id)}
							<li>
								<button
									type="button"
									class="flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-[13px] transition hover:bg-surface-2 {selectedProjectId === project.id ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2'}"
									onclick={() => selectProject(project.id)}
								>
									<span class="truncate">{project.name}</span>
									<span class="ml-2 shrink-0 text-[11px] text-ink-3">
										{new Date(project.createdAt).toLocaleDateString()}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<section class="card p-4 lg:col-span-7">
			{#if selectedProject}
				<div class="flex flex-col gap-5">
					<div class="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
						<div class="flex-1 min-w-[200px]">
							<label for="rename-project-name" class="mb-1 block text-[12px] text-ink-2">
								Project name
							</label>
							<div class="flex gap-2">
								<input
									id="rename-project-name"
									type="text"
									class="field flex-1 text-[13px]"
									maxlength={MAX_NAME_CHARS}
									bind:value={renameDraft}
								/>
								<button
									type="button"
									class="btn"
									disabled={!renameDraft.trim() || renameDraft.trim() === selectedProject.name}
									onclick={renameCurrentProject}
								>
									Rename
								</button>
							</div>
						</div>
						<button
							type="button"
							class="btn text-red-400 hover:text-red-300"
							onclick={removeCurrentProject}
						>
							Delete project
						</button>
					</div>

					<div>
						<div class="mb-1.5 flex items-baseline justify-between gap-2">
							<label for="project-instructions" class="text-[13px] font-medium text-ink">
								Project instructions
							</label>
							<span class="text-[11.5px] text-ink-3">
								{instructionsDraft.length} / {MAX_INSTRUCTIONS}
							</span>
						</div>
						<p class="mb-2 text-[12px] leading-relaxed text-ink-3">
							Instructions are per-project text attached to a turn as untrusted context; they never grant permissions.
						</p>
						<textarea
							id="project-instructions"
							class="field w-full text-[13px] leading-relaxed"
							rows="4"
							maxlength={MAX_INSTRUCTIONS}
							placeholder="e.g. Focus on clean architecture and provide test-driven TypeScript solutions."
							bind:value={instructionsDraft}
						></textarea>
					</div>

					<div class="border-t border-line pt-4">
						<div class="mb-1.5 flex items-baseline justify-between gap-2">
							<span class="text-[13px] font-medium text-ink">
								Files ({filesDraft.length} of {MAX_PROJECT_FILES})
							</span>
						</div>
						<p class="mb-3 text-[12px] leading-relaxed text-ink-3">
							Files are labels only — nothing is read from disk, no filesystem read is performed, and a project is never a permission. Capped at {MAX_PROJECT_FILES} files.
						</p>

						{#if filesDraft.length === 0}
							<p class="mb-3 text-[12px] text-ink-3" role="status">
								No file labels attached to this project.
							</p>
						{:else}
							<div class="mb-4 overflow-x-auto">
								<table class="w-full text-left text-[12.5px]">
									<thead>
										<tr class="border-b border-line text-[11px] uppercase tracking-wider text-ink-3">
											<th class="py-1.5 font-medium">Path label</th>
											<th class="py-1.5 font-medium">Bytes</th>
											<th class="py-1.5 text-right font-medium">Action</th>
										</tr>
									</thead>
									<tbody>
										{#each filesDraft as file (file.path)}
											<tr class="border-b border-line/50">
												<td class="py-1.5 font-mono text-ink">{file.path}</td>
												<td class="py-1.5 text-ink-2">{file.bytes.toLocaleString()}</td>
												<td class="py-1.5 text-right">
													<button
														type="button"
														class="btn btn-sm"
														aria-label={"Remove file label " + file.path}
														onclick={() => removeFile(file.path)}
													>
														Remove
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						{#if filesDraft.length < MAX_PROJECT_FILES}
							<div class="rounded border border-line bg-surface-1 p-3">
								<span class="mb-2 block text-[12px] font-medium text-ink">
									Add file label
								</span>
								<div class="grid grid-cols-1 gap-2 sm:grid-cols-12">
									<div class="sm:col-span-7">
										<label for="new-file-path" class="mb-1 block text-[11.5px] text-ink-3">
											Relative path
										</label>
										<input
											id="new-file-path"
											type="text"
											class="field w-full font-mono text-[12px]"
											placeholder="src/lib/example.ts"
											bind:value={newFilePath}
										/>
									</div>
									<div class="sm:col-span-3">
										<label for="new-file-bytes" class="mb-1 block text-[11.5px] text-ink-3">
											Bytes
										</label>
										<input
											id="new-file-bytes"
											type="number"
											min="0"
											step="1"
											class="field w-full text-[12px]"
											placeholder="1024"
											bind:value={newFileBytes}
										/>
									</div>
									<div class="flex items-end sm:col-span-2">
										<button
											type="button"
											class="btn w-full"
											disabled={!newFilePath.trim()}
											onclick={addFile}
										>
											Add
										</button>
									</div>
								</div>
							</div>
						{:else}
							<p class="text-[12px] text-ink-3" role="status">
								Maximum {MAX_PROJECT_FILES} file labels reached for this project.
							</p>
						{/if}
					</div>

					<div class="flex justify-end pt-2">
						<button
							type="button"
							class="btn btn-solid"
							onclick={saveDetail}
						>
							Save project details
						</button>
					</div>
				</div>
			{:else}
				<div class="flex h-full min-h-[200px] flex-col items-center justify-center p-6 text-center">
					<p class="text-[13px] text-ink-3" role="status">
						Select a project from the list to view and edit its details.
					</p>
				</div>
			{/if}
		</section>
	</div>
</View>
