# Pre-Publication Checklist

Complete ALL items before making any repo public. No exceptions.

---

## 1. atlas-protocol repo (whitepaper + protocol spec)

### Files to KEEP (public-facing)
- [ ] `01-whitepaper/WHITEPAPER.md` — polished, AI-scrubbed
- [ ] `02-protocol-core/PROTOCOL-SPEC.md` — formal spec
- [ ] `02-protocol-core/SCHEMAS.md` — schema reference
- [ ] `02-protocol-core/PROGRESSIVE-DECENTRALIZATION.md` — decentralization architecture
- [ ] `09-governance/GOVERNANCE-CHARTER.md` — governance model
- [ ] `09-governance/ROADMAP.md` — public roadmap
- [ ] `WIKI.md` — repo overview (rewrite as a clean README.md)
- [ ] `LICENSE` — CC BY 4.0 for the spec

### Files to REMOVE before public (move to private `atlas-internal/` or `lemonade-mpp/`)
- [ ] `impl/` — entire folder (IMPL handovers, audit fixes). Internal engineering.
- [ ] `AUDIT-FIXES.md`, `AUDIT-R2-FIXES.md`, `AUDIT-R3-FIXES.md`, `AUDIT-R4-FIXES.md` — internal audit docs
- [ ] `UNIFIED-STRATEGY.md` — internal product strategy
- [ ] `PRE-PUBLICATION-CHECKLIST.md` — this file
- [ ] `03-organizer-layer/` — internal product design (public version goes in docs site, not repo)
- [ ] `04-platform-layer/` — internal (SDK docs go in the SDK repo)
- [ ] `05-platform-builder/` — internal (marketing material, not protocol spec)
- [ ] `06-agent-layer/` — internal (SDK docs go in the client SDK repo)
- [ ] `07-economics/` — internal (fee structure is in the whitepaper; detailed tokenomics stays private until token launch)
- [ ] `08-marketing/` — internal (GTM, partnerships). Never public.
- [ ] `10-competitive-intel/` — internal. Never public.
- [ ] `lemonade-mpp/ATLAS-MAPPING.md` — internal mapping doc

### Folder structure after cleanup
```
atlas-protocol/          (PUBLIC)
├── README.md            (rewritten from WIKI.md, clean human voice)
├── LICENSE              (CC BY 4.0)
├── whitepaper/
│   └── WHITEPAPER.md    (polished)
├── spec/
│   ├── PROTOCOL-SPEC.md
│   ├── SCHEMAS.md
│   └── PROGRESSIVE-DECENTRALIZATION.md
├── governance/
│   ├── CHARTER.md
│   └── ROADMAP.md
└── assets/
    └── (diagrams, logos if any)
```

---

## 2. atlas-registry repo (registry service code)

### Code quality
- [ ] Zero `// AUDIT FIX` comments in source code
- [ ] Zero `// TODO: from IMPL` or references to internal docs
- [ ] Zero overly explanatory comments ("This function handles the processing of...")
- [ ] Comments say WHY, not WHAT. If the code is clear, no comment needed.
- [ ] No dead code, no commented-out blocks
- [ ] Consistent code style (run linter, fix all warnings)

### Documentation
- [ ] Clean README.md: what it is, how to run, how to deploy. 50 lines max.
- [ ] CONTRIBUTING.md: how to contribute (if accepting contributions)
- [ ] LICENSE: MIT or BSL 1.1 (per governance charter)
- [ ] No internal references (no mentions of "lemonade-backend", "lemonade-ai", "IMPL", "audit")

### Dependencies
- [ ] No private package references in package.json
- [ ] No hardcoded internal URLs (use environment variables)
- [ ] No leaked credentials, API keys, or secrets in any file or git history

---

## 3. Language scrub (ALL public files)

### AI writing patterns to eliminate
- [ ] **Zero em dashes (—).** Search all .md files: `grep -r '—'`. Rewrite every occurrence.
- [ ] **Zero "Furthermore", "Moreover", "Additionally", "It's worth noting", "Importantly"**
- [ ] **Zero "This ensures", "This enables", "This allows", "This means"**
- [ ] **Zero "robust", "seamless", "comprehensive", "innovative", "cutting-edge", "leverage/leveraging"**
- [ ] **Zero "In this section", "As mentioned above", "As we discussed"**
- [ ] **Zero "By" + gerund sentence starters** ("By leveraging...", "By combining...")
- [ ] **Zero "In order to"** — just use "to"
- [ ] **Zero "It is important to note that"** — just state the thing
- [ ] **Zero "plays a crucial role"** or "is a key component"
- [ ] **Zero triple-adjective descriptions** ("fast, secure, and scalable")

### Positive voice markers (should be present)
- [ ] Short sentences (under 25 words preferred)
- [ ] Active voice throughout
- [ ] Concrete numbers instead of vague claims
- [ ] Technical terms used precisely (not for decoration)
- [ ] Reads like it was written by someone who built the thing, not someone describing it

### Manual read-through
- [ ] Read the entire whitepaper out loud. If any sentence sounds like ChatGPT wrote it, rewrite.
- [ ] Have a human (not AI) read and flag anything that feels generated
- [ ] Check that the writing has personality and conviction, not corporate neutrality

---

## 4. Git history scrub (ALL public repos)

### Commit messages
- [ ] Zero "Co-Authored-By: Claude" or any AI attribution
- [ ] Zero "Co-Authored-By: Claude Opus" or similar
- [ ] Zero commit messages that read like AI output (overly descriptive, too perfect)
- [ ] Good human commit messages: short, lowercase, imperative mood ("add federated search", not "Implement comprehensive federated search functionality with parallel fan-out")
- [ ] Squash messy history into clean logical commits before making public

### How to scrub
```bash
# Check for AI attribution in entire history
git log --all --format="%H %s" | grep -i "claude\|anthropic\|co-authored"

# If found, interactive rebase to remove
# Or: create a fresh repo with squashed history
git checkout --orphan clean-main
git add -A
git commit -m "initial commit"
git branch -D main
git branch -m main
git push origin main --force  # ONLY on the new public repo, never on existing private repos
```

### Files in git history
- [ ] No internal docs (IMPL, audit fixes, strategy) ever committed to public repos
- [ ] No credentials, API keys, or .env files in any historical commit
- [ ] No large binaries or node_modules in history
- [ ] Run `git log --all --diff-filter=A --name-only` to check all files ever added

---

## 5. Metadata and accounts

### Repository settings
- [ ] Description: clear, one-line ("Open protocol for agent-driven event ticketing")
- [ ] Topics/tags: `protocol`, `events`, `ticketing`, `mpp`, `web3`, `agents`
- [ ] No reference to Lemonade in repo description (protocol is neutral)
- [ ] License badge in README
- [ ] No "Built with Claude" or similar badges

### Domain and branding
- [ ] Protocol website domain secured (atlas.events or similar)
- [ ] GitHub organization name is protocol-branded (not lemonade-branded)
- [ ] Logo and visual identity ready (if applicable)
- [ ] Social accounts created (Twitter/X for protocol announcements)

---

## 6. Final verification

- [ ] Clone each public repo fresh into a new directory
- [ ] Read every file as if you're seeing it for the first time
- [ ] Search for: `lemonade` (should only appear as "founding contributor" context, not as product references)
- [ ] Search for: `claude`, `anthropic`, `AI`, `GPT` (zero results in code or docs)
- [ ] Search for: `IMPL`, `AUDIT`, `audit fix`, `R1`, `R2`, `R3`, `R4` (zero results)
- [ ] Search for: `session`, `prompt`, `subagent` (zero results)
- [ ] Search for: `TODO`, `FIXME`, `HACK` (zero or intentional only)
- [ ] Verify all links in docs point to valid URLs
- [ ] Verify README renders correctly on GitHub
- [ ] Have someone outside the team review before flipping to public
