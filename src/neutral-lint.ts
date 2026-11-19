// PLT-84 SN-002: a stack-neutral core names no stack, framework, language, file suffix or path.
// Same pattern as the fleet's mechanical check (runs-stage1). Differences: this lint also scans core.verification
// (the stage-1 fleet lint did not), and it ignores prose alternations of test kinds such as "e2e/journey".
export const LEAK = /\b(bun|bunx|bun:|node:|deno|npm|pnpm|yarn|typescript|javascript|tsx?|jsx?|htmx|playwright|vitest|jest|python|pytest|fastapi|django|express\.js|expressjs|fastify|koa|hono|react|vue|svelte|package\.json|tsconfig|lockfile\s*\(bun)\b|\.(ts|tsx|js|mjs|py|go|java|rb)\b|(^|[\s`(])(src|tests?|e2e|plan|lib)\/|\*\*\/|<(source|test|plan|e2e)_root>/i;

export function coreTexts(core: any): string[] {
  return [core.title, core.given, core.when, core.then, ...(core.prefer ?? []), ...(core.avoid ?? []), ...(core.unless ?? []),
    core.why, ...(core.evidence ?? []), ...(core.verification ?? []), ...(core.activation?.fires ?? []), ...(core.activation?.doesNotFire ?? []),
    ...(core.activation?.facts ?? []).flatMap((f: any) => f.values ?? [])].filter((x) => x !== undefined).map(String);
}

/** Prose alternations that look like a path to LEAK but name test kinds ("an e2e/journey test"). */
export const PROSE_ALTERNATIONS = /\b(e2e\/journey|journey\/e2e|unit\/acceptance|acceptance\/e2e)\b/gi;

export function neutralityLeaks(core: unknown): string[] {
  return coreTexts(core).flatMap((t) => {
    const m = t.replace(PROSE_ALTERNATIONS, "test-kinds").match(LEAK);
    return m ? [m[0] + " in: " + t.slice(0, 100)] : [];
  });
}
