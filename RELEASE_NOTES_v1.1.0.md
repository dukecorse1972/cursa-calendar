# 🎓 Cursa — v1.1.0 Official Release

> **The High-Performance Academic Workstation & Productivity Companion for Google Calendar on Windows.**

We are pleased to announce the milestone release of **Cursa v1.1.0**! This release introduces the all-new **Grade Simulator & Academic Performance Module**, fully powered by Google Gemini 2.5 Flash and interactive Google Calendar linking.

---

## 📥 Downloads & Assets

| Asset | Platform | Description | Size |
|---|---|---|---|
| 🚀 [**Cursa-Setup-1.1.0.exe**](https://github.com/dukecorse1972/cursa/releases/download/v1.1.0/Cursa-Setup-1.1.0.exe) | Windows 10/11 x64 | **Official NSIS Installer (Recommended)**: Per-user install, zero UAC elevation, desktop & start menu shortcuts. | ~80 MB |
| 📦 [**Cursa-v1.1.0-windows-x64.zip**](https://github.com/dukecorse1972/cursa/releases/download/v1.1.0/Cursa-v1.1.0-windows-x64.zip) | Windows 10/11 x64 | **Portable Distribution**: Unzip anywhere, run on USB drives without touching registry. | ~115 MB |
| 📝 [**Source Code (zip)**](https://github.com/dukecorse1972/cursa/archive/refs/tags/v1.1.0.zip) | Multi-platform | Full TypeScript codebase, 90 automated tests, and build scripts. | — |

---

## 🌟 What's New in v1.1.0

### 1. 🧮 Interactive Grade Simulator & Performance Hub
- **Instant Workspace Switcher (`Calendar` ⇄ `Calificaciones`)**: Switch seamlessly at 0ms latency between your Google Calendar grid and the dedicated Grade Simulator overlay without page reloads.
- **Subject Tabs with ECTS Credits**: Direct access to your enrolled courses with individual ECTS indicators and distinct palette styling.
- **Inverse Target Solver ("What do I need to pass?")**: Choose a target goal (`Aprobar 5.0`, `Notable 7.0`, `Sobresaliente 9.0`) to calculate the exact grade required in the remaining pending exam.
- **Live Exploration Slider**: Experiment in real time with hypothetical exam scores (0.0 to 10.0) and see your course grade update live.
- **Cut-Off Minimum Grade Alerts**: Strict validation enforcing professor cut-off rules (e.g., minimum 4.50 in the final exam required to average).

### 2. 🤖 Conversational AI Course Setup (Google Gemini 2.5 Flash)
- **Natural Language Course Setup**: Explain your grading scheme in natural language (e.g., *"We have two 15% midterms, 30% labs, and a 50% final exam with a 4.5 cut-off"*).
- **Native Structured Outputs (`responseSchema`)**: Powered by Google Gemini 2.5 Flash with forced JSON schema, guaranteeing zero formatting hallucinations and mathematical 100% weight consistency.
- **Offline Fallback Engine**: Built-in deterministic university semantic engine allowing course creation even when offline or before configuring an API key.

### 3. 🎯 Visual Calendar Linking Mode
- **1-Click Grid Binding (`🔗 Vincular al Cal.`)**: Temporarily switches to the calendar grid with a guidance banner, automatically filtering by subject.
- **Direct Chip Assignment**: Clicking any exam or delivery chip instantly binds it to the grade simulator item and returns automatically.
- **100% Optional**: Supports classroom participation, bonus points, or un-scheduled homework without requiring calendar events.

### 4. 🛡️ Quality Gate & Reliability
- **90 Automated Unit & Integration Tests**: 23 test suites passing at 100%, covering weighted calculations, target solvers, cut-off rules, and AI syllabus reasoning.
- **Account-Isolated Local Storage**: All course grades and API keys persist securely and privately per Google Account partition.

---

## 💻 System Requirements
- **OS**: Windows 10 or Windows 11 (64-bit)
- **Account**: Google Account with Google Calendar
- **Installation**: No administrative privileges required (`%LOCALAPPDATA%\Programs\Cursa`)
