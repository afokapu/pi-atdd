# ATD-58 MCP exclusion investigation

## Findings

- `--exclude-tools 'mcp__wispr*,mcp__granola*,mcp__google*'` filters matching tools; it does not disable MCP. Pi 1.5.2 documentation says every enabled MCP server connects in the background at session start. `--no-mcp` is the switch that prevents server connections, but would also remove Linear tools.
- A real Pi 1.5.2 RPC launch in a disposable directory passed the exclusion flag while loading the AF8 Wispr and Linear entries. It produced no Wispr 429 output and no MCP log, so the live endpoint did not provide direct connection evidence or reproduce a warning in this run.
- A controlled local Wispr-named HTTP MCP endpoint returning 429 received 3 requests during real Pi startup despite the exclusion. Sending `/reload` produced 0 additional requests. Pi's captured RPC stderr did not contain a 429 warning.

## Conclusion and limits

Tool exclusion does not prevent MCP server connections. It therefore cannot by itself be relied on to prevent server-side rate limiting or warnings associated with connection startup. The controlled 429 endpoint verified startup requests, but did not reproduce a Wispr-generated warning; the live Wispr endpoint emitted no 429 in this run. A later actual Wispr warning may still occur if that server returns 429 while connecting or servicing a call. Pi docs: `docs/mcp.md` (enabled servers connect in the background; `--exclude-tools` filters tools; `--no-mcp` disables MCP).
