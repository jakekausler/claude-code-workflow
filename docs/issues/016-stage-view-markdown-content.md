---
title: "Stage view: markdown content + frontmatter metadata"
phase: 11
labels: [feature, ui]
depends_on: []
---

# Stage View: Markdown Content + Frontmatter Metadata

Render the stage file's markdown body and relevant frontmatter metadata on the stage detail view.

## Requirements

- Parse the stage markdown file and render its body content (below the frontmatter)
- Display relevant frontmatter metadata not already shown in the stage detail view
- Use the existing markdown rendering infrastructure (if any) or add a markdown renderer
- Frontmatter fields already displayed in the UI should not be duplicated

## Technical Notes

- Stage files have YAML frontmatter + markdown body
- The API already returns stage file paths; need to read and parse the file content
- Consider using a library like `react-markdown` or `marked` for rendering
- The stage detail drawer/page currently shows structured data from the DB but not the raw file content
