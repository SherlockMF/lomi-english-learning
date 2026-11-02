# Lomi English — AI Speaking Practice & FSRS English Learning

[简体中文](README.md) · [Visit the app](https://english.lomivex.top) · [Deployment guide (Chinese)](docs/deployment.md)

**Lomi English (洛米英语)** is a local-first English learning web app combining **AI speaking practice, vocabulary learning, active recall, and FSRS spaced repetition**. Practice recalling and using expressions instead of choosing answers from a list.

It covers everyday English, Malaysian university life, business English, finance, and accounting. The interface is primarily in Chinese, with bilingual vocabulary and examples. The hosted app allows browsing; cloud learning and AI services require an invited account. Membership plans are a preview only, with no purchasing or paid-plan activation yet.

## Features

- **Active recall:** practice English-to-Chinese meaning, Chinese/context-to-English recall, and sentence use. Each word sense has its own review history.
- **FSRS spaced repetition:** schedule reviews around a target retention rate, with a shared daily study budget and adjustable new-expression limits.
- **AI English speaking practice:** Qwen powers real-time voice conversations and recorded voice messages. Practice everyday, business, finance, accounting, or custom scenarios.
- **AI feedback:** optional DeepSeek assistance for semantic grading, hints, vocabulary completion, and speaking transcript corrections. Save useful expressions from feedback into your review queue.
- **Vocabulary and dictionaries:** 7,503 bundled seed senses, additional dictionary senses, bilingual examples, UK/US pronunciation, personal vocabulary, and batch import.
- **Learning evidence:** track recall, delayed retention, and contextual use separately. Completing a conversation does not automatically count as mastery.
- **Local-first storage:** use IndexedDB for browser learning data and export learning backups. Basic vocabulary study and FSRS reviews do not require AI credentials.
- **Optional cloud sync:** an invite-only Supabase setup syncs account learning data and speaking history. Voice-message recordings use private Storage and download on demand.

## Quick start

Requirements: **Node.js 22+**, npm, and Git. Node.js 22 matches CI.

```bash
git clone https://github.com/SherlockMF/lomi-english-learning.git
cd lomi-english-learning
npm ci
npm run dev
```

Open the local URL printed by Vite. The first launch imports the bundled vocabulary into IndexedDB. Leave the Supabase build variables unset for local mode.

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

Stack: **React 19, TypeScript, Vite, IndexedDB, ts-fsrs, Node.js, and optional Supabase**.

## Deployment and repository

The maintained branch is **`master`**. Render serves the Node.js application; Supabase provides invited-account authentication, database sync, and private audio storage. Follow the [deployment guide](docs/deployment.md) before deploying: it covers migrations, membership access, environment variables, email, and backups. Automatic deployment is disabled in the Blueprint.

This repository was renamed from `recall-english` to `lomi-english-learning`. Update existing clones with:

```bash
git remote set-url origin https://github.com/SherlockMF/lomi-english-learning.git
git fetch origin --prune
```

The previous feature-branch histories are consolidated into `master`. Existing Render services must be checked for an obsolete branch binding before the next manual deployment. Internal database identifiers, backup filenames, and the existing Render service name retain `recall-english` for continuity.

## Privacy and licensing

- In local mode, learning data stays in the browser. DeepSeek credentials are stored per browser origin; voice credentials are stored by the local server.
- In cloud mode, learning data and speaking history sync to Supabase. Voice-message audio uses private Storage; provider credentials are managed on the server.
- Dictionary and AI features send the necessary queries, text, or audio to their service providers. Review their terms and usage charges.
- Learning backups do not include API credentials, speaking history, or recordings. Export or back up the relevant data before clearing browser storage.

The repository does not currently include a standalone open-source LICENSE. Public visibility does not grant unrestricted redistribution or commercial-use permission. Dependencies and vocabulary sources retain their respective licenses; see the [word-level data notes](data/word-levels/README.md).
