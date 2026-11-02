<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
</script>

<main class="grid min-h-dvh w-full place-items-center p-6 text-center">
	<div class="space-y-4">
		<p class="text-sm font-medium text-muted-foreground">{page.status}</p>
		<h1 class="text-2xl font-semibold">{page.error?.message ?? 'Something went wrong'}</h1>
		{#if page.error?.id}<p class="text-xs text-muted-foreground">Reference: {page.error.id}</p>{/if}
		{#if page.status >= 500}<Button variant="outline" onclick={() => window.location.reload()}
				>Reload page</Button
			>{/if}
		<Button href="/">Back to the workspace</Button>
	</div>
</main>
