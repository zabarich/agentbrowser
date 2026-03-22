# Roadmap

## v0.1 — Core Agent (Current)

- [x] Anthropic Claude as LLM provider
- [x] Playwright-based browser automation
- [x] Agent loop: observe-think-act cycle
- [x] DOM extraction and indexed serialization
- [x] 12 browser actions (click, navigate, input_text, scroll, extract, screenshot, select_dropdown, send_keys, go_back, wait, switch_tab, done)
- [x] Loop detection and failure recovery
- [x] Message compaction for long-running tasks
- [x] System prompts adapted from browser-use

### Known Limitations (v0.1)

- **Event listener detection:** Cannot detect `addEventListener()` JS listeners (requires CDP). Uses attribute/role heuristics instead, covering ~90% of interactive elements.
- **Paint order filtering:** Does not detect occluded elements via z-index/paint order.
- **Single LLM provider:** Anthropic only. The `LLMProvider` interface supports adding others.
- **Local browser only:** No cloud browser session support.

## v0.2 — Planned

- [ ] OpenAI GPT provider
- [ ] Google Gemini provider
- [ ] CDP-based event listener detection for better interactive element coverage
- [ ] Paint order filtering for occluded elements
- [ ] Agent planning mode (plan_update, current_plan_item)
- [ ] Streaming step results via async iterables
- [ ] Custom action registry (user-defined actions)

## v0.3 — Future

- [ ] Ollama / local model support
- [ ] Cloud browser sessions (Browserbase, etc.)
- [ ] File system operations (read/write files during tasks)
- [ ] Skill modules for reusable workflows
- [ ] Visual debugging (annotated screenshots, step replay)
- [ ] Video recording / GIF capture
- [ ] Proxy and authentication support
- [ ] Cookie and profile persistence
