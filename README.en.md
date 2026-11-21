# Lomi English — AI Speaking Practice & FSRS English Learning

[简体中文](README.md) · [Visit the app](https://english.lomivex.top) · [Deployment guide (Chinese)](docs/deployment.md)

**Lomi English (洛米英语)** is a local-first English learning web app combining **AI speaking practice, vocabulary learning, active recall, and FSRS spaced repetition**. Practice recalling and using expressions instead of choosing answers from a list.

It covers 26 areas, including university life, daily situations, and academic subjects. The interface is primarily in Chinese, with bilingual vocabulary and examples. Visitors can browse the hosted app and register by email to begin learning. Membership plans currently show a preview.

## Features

- **Active recall:** practice English-to-Chinese meaning, Chinese/context-to-English recall, and sentence use. Each word sense has its own review history.
- **FSRS spaced repetition:** schedule reviews around a target retention rate, with a shared daily study budget and adjustable new-expression limits.
- **AI English speaking practice:** Qwen powers real-time voice conversations and recorded voice messages. Practice everyday, business, finance, accounting, or custom scenarios.
- **AI feedback:** optional DeepSeek assistance for semantic grading, hints, vocabulary completion, and speaking transcript corrections. Save useful expressions from feedback into your review queue.
- **Vocabulary and dictionaries:** 37,462 built-in senses, including 29,959 new V6 senses across 26 areas. Choose and rank your areas at first launch or in the library. Existing cloud accounts can opt in to new content while keeping their current vocabulary and progress.
- **Learning evidence:** track recall, delayed retention, and contextual use separately. Completing a conversation does not automatically count as mastery.
- **Local-first storage:** use IndexedDB for browser learning data and export learning backups. Basic vocabulary study and FSRS reviews do not require AI credentials.
- **Optional cloud sync:** Neon syncs learning data and speaking history. Voice-message recordings use private Object Storage and download on demand.

## Quick start

Requirements: **Node.js 22+**, npm, and Git. Node.js 22 matches CI.

```bash
git clone https://github.com/SherlockMF/lomi-english-learning.git
cd lomi-english-learning
npm ci
npm run dev
```

Open the local URL printed by Vite. The first launch imports the bundled vocabulary into IndexedDB. Local mode needs no cloud build variables.

Optional AI setup:

1. Configure a DeepSeek API Key in settings for AI grading and text feedback.
2. Configure an Alibaba Cloud Model Studio Beijing-region API Key and workspace ID for Qwen voice practice. The account needs access to the configured realtime model.
3. Use localhost or HTTPS for microphone access. Provider usage may incur charges.

See the [Chinese README](README.md) for detailed voice setup, data handling, dictionary maintenance, and troubleshooting.

## Development

```bash
npm run lint        # Static checks
npm test            # Unit and component tests
npm run build       # TypeScript checks and production build
```

For browser tests, install Chromium and build first:

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

The test server uses port 5188. Browser tests use isolated data and do not validate real microphone quality or paid AI calls. CI runs on Ubuntu, Windows, and macOS, including application share-bundle checks.

Stack: **React 19, TypeScript, Vite, IndexedDB, ts-fsrs, Node.js, and Neon**.

## Deployment and repository

The maintained branch is **`master`**. Render serves the Node.js application and Neon provides authentication, sync, and private audio storage. The Blueprint uses manual deployments. [Deployment guide](docs/deployment.md)

This repository was renamed from `recall-english` to `lomi-english-learning`. Update existing clones with:

```bash
git remote set-url origin https://github.com/SherlockMF/lomi-english-learning.git
git fetch origin --prune
```

The previous feature-branch histories are consolidated into `master`. Existing Render services must be checked for an obsolete branch binding before the next manual deployment. Internal database identifiers, backup filenames, and the existing Render service name retain `recall-english` for continuity.

## Privacy and licensing

- In local mode, learning data stays in the browser. DeepSeek credentials are stored per browser origin; voice credentials are stored by the local server.
- In cloud mode, learning data and speaking history sync to Neon. Voice-message audio uses private Object Storage. The server manages provider credentials.
- Dictionary and AI features send the necessary queries, text, or audio to their service providers. Review their terms and usage charges.
- Learning backups do not include API credentials, speaking history, or recordings. Export or back up the relevant data before clearing browser storage.

The repository does not currently include a standalone open-source LICENSE. Public visibility does not grant unrestricted redistribution or commercial-use permission. Dependencies and vocabulary sources retain their respective licenses; see the [word-level data notes](data/word-levels/README.md).
