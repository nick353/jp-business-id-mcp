# Japan Business ID MCP

An MCP server that validates Japanese business identifiers, so an agent reading or issuing Japanese invoices catches typos before money moves:

- **Qualified invoice registration numbers** (適格請求書発行事業者登録番号, `T` + 13 digits) — format, check digit, whether it is a corporation's number, and the official lookup URL
- **Corporate numbers** (法人番号, 13 digits) — National Tax Agency check digit formula; on a typo it tells you the expected check digit
- **Build a corporate number** from a 12-digit company registry number (会社法人等番号)
- **Extract** every invoice / corporate number from invoice or contract text and validate them in one call

No API key, no sign-in, read-only. Full-width digits and hyphens are accepted.

A passing check digit means the number is well-formed, not that it is registered. Each result includes `lookup_url` on the official National Tax Agency site to confirm. The NTA does not publish a check scheme for sole proprietors' invoice numbers, so those are reported as "cannot be decided offline" instead of guessed.

## Connect

Streamable HTTP endpoint: `https://jp-business-id-mcp.nichika2000823.workers.dev/mcp`

```bash
claude mcp add --transport http jp-business-id https://jp-business-id-mcp.nichika2000823.workers.dev/mcp
```

Any MCP client that supports remote (Streamable HTTP) servers works the same way: Cursor, VS Code, ChatGPT, Gemini CLI.

## Tools

| Tool | What it does |
|---|---|
| `validate_invoice_number` | `T8700110005901` → valid format, corporation, lookup URL |
| `validate_corporate_number` | `1700110005901` → invalid, expected check digit 8 |
| `corporate_number_from_base` | `700110005901` → `8700110005901` |
| `extract_business_ids` | Find and validate all IDs in a document |

## 日本語

インボイス登録番号（T＋13桁）と法人番号を、国税庁の検査用数字の計算式で確かめる MCP サーバーです。請求書の文面からまとめて拾うこともできます。登録の有無は結果の lookup_url（国税庁の公表サイト）で確かめてください。

## Privacy

Usage is counted with a salted hash of the caller that rotates every two weeks; raw IP addresses and the numbers you send are not stored.

Check digit formula: https://www.houjin-bangou.nta.go.jp/documents/checkdigit.pdf

MIT License.
