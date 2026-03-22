# Changelog

## 0.1.0 — 2026-03-22

Initial release.

- Core agent loop (observe → think → act)
- Playwright browser automation (headless Chromium)
- Anthropic Claude LLM provider
- OpenAI-compatible LLM provider (local models, OpenAI, Groq, etc.)
- Auto-disable vision for text-only local models
- 15 browser actions (click, navigate, input_text, scroll, extract, screenshot, select_dropdown, send_keys, go_back, wait, switch_tab, done, plus search_page and find_elements via extract)
- DOM distillation with indexed interactive elements (`[index]<tagname />` format)
- Loop detection and automatic recovery nudges
- Message compaction for long-running tasks
- System prompts adapted from browser-use (8,900+ commits of community refinement)
- 148 unit/integration tests, 6 e2e test files, 4 working examples
