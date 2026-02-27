Things we still need to do that are not listed in stage 10
- add filters for what jira information allows a ticket to be automatically pulled (e.g. tags, etc)
- Allow github/gitlab issues to be imported as "tickets" just like jira tickets. We will need manual epic management for these, and will probably need to allow tickets without linked epics (if not already allowed)
- On the stage view, we want to show the markdown content of the stage file and relevant metadata from the frontmatter not already shown (if any).
- We need to move the checklist template and content for stages to frontmatter yaml (this will make the checklist not show on the stage view when the previous item is implemented, which is intentional)
- Under each phase on the stage view there is a "Content available in future update" placeholder. This is intended for sibling markdown content created as outputs during each phase (see those skills and the design doc for more details) to be rendered
- make dependency page work
- create a mr tree view page
- add heavy credit to claude-devtools (lifted a lot of algorithms, layouts, design, and others directly). add inspiration credit to vibe-kanban


Things to test
- run the orchestrator with mocked MCPs (use the seed script)
  - stages move from phase to phase correctly as it goes
  - users can respond when Claude stops from the browser
  - logs say external services would have been called vorrectly
  - mocked comments are correctly responded to
  - session log is viewable and live updated in the phase drawer
  - manual tickets are convertible in a session on the web UI board drawer
  - stages move through when dependencies are unlocked
- run with real services (set up with real connections, preferably something breakable like a jira board and git repo we can script seed and tear down and a personal slack channel)
  - jira tickets are pulled in if they are in the configured project and have the correct settings (e.g. label, status, etc.)
  - jira tickets go to to convert
  - conversion gets all linked info from ticket (e.g. comments, attachments, confluence, links, etc.)
  - stages go to mr
  - comments on the mr are pulled in and responded to and addressed
  - pings happen for user input needed, Mrs created, comments addressed
  - works with gitlab and github
  - staged progress when dependencies in Mr starts
  - tickets on jira move through in progress, testing, and done as stages progress
