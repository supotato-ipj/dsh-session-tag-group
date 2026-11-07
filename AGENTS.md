## Agent skills

### Issue tracker

GitHub Issues (repo inferred from `git remote -v`; `supotato-ipj/dsh-pin-session-tag-group`, private). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage labels, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Matt-skills discipline

- Matt 系列技能严格按其文档执行：输入缺失或有歧义时，把选项摆给用户选，不自行取默认值，也不做技能文档之外的默认动作。
- 技能内置的确认步骤是硬门：每个需要用户确认的节点，等明确答复后再继续；未经答复不写入文件、不执行命令、不推进流程。
- `grilling` / `grill-me` / `grill-with-docs` 问答结束后：先在对话中输出「共识清单」（逐条列出双方确认的决定），询问用户是否确认；得到明确答复前，禁止执行任何后续动作。
