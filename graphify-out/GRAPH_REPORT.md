# Graph Report - hspk-ahsp-importer  (2026-09-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 484 nodes · 707 edges · 33 communities (29 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `487d62fb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- package.json
- fullExport.routes.js
- rab.routes.js
- excelParser.js
- complain.routes.js
- survey.routes.js
- surveyView.routes.js
- upload.routes.js
- timeScheduleExportHelper.js
- crudGrub/bast.routes.js
- tsView.routes.js
- parseHspkText
- dependencies
- complainView(bast_2).routes.js
- index.js
- bvView.routes.js
- app1.js
- rabView.routes.js
- bv.routes.js
- jobs.routes.js
- server.js
- lib/prisma.js
- rabGrub.routes.js
- samoah/clients.js
- samoah/hspk.js
- samoah/projects.js
- summarize-issues.js
- routes/clients.js
- routes/hspk.js
- routes/projects.js
- samoah/prisma.js

## God Nodes (most connected - your core abstractions)
1. `parseAhspSheet()` - 15 edges
2. `buildTimeScheduleSheet()` - 14 edges
3. `parseHspkText()` - 11 edges
4. `drawAreaRowSplit()` - 11 edges
5. `streamComplaintPdff()` - 10 edges
6. `streamComplaintPdf()` - 10 edges
7. `renderScheduleHtml()` - 9 edges
8. `buildRabSheet()` - 8 edges
9. `renderItemRow()` - 8 edges
10. `cellStr()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `parseExcelBuffer()` --calls--> `parseHspkText()`  [EXTRACTED]
  src/parsers/excelParser.js → src/parsers/textStateParser.js
- `parsePdfBuffer()` --calls--> `parseHspkText()`  [EXTRACTED]
  src/parsers/pdfParser.js → src/parsers/textStateParser.js
- `parseHspkText()` --calls--> `parseCoefficientLine()`  [EXTRACTED]
  src/parsers/textStateParser.js → src/parsers/lineParser.js
- `parseHspkText()` --calls--> `parsePriceLine()`  [EXTRACTED]
  src/parsers/textStateParser.js → src/parsers/lineParser.js
- `parseExcelBuffer()` --calls--> `looksLikeAhspSheet()`  [EXTRACTED]
  src/parsers/excelParser.js → src/parsers/ahspSheetParser.js

## Import Cycles
- None detected.

## Communities (33 total, 2 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.05
Nodes (42): description, devDependencies, nodemon, prisma, dotenv, express, nodemon, prisma (+34 more)

### Community 1 - "fullExport.routes.js"
Cohesion: 0.07
Nodes (32): exceljs, { buildBvSheet }, ExcelJS, express, prisma, router, { buildBvSheet }, { buildRabSheet } (+24 more)

### Community 2 - "rab.routes.js"
Cohesion: 0.06
Nodes (29): bcrypt, jsonwebtoken, authorizeRoles(), jwt, verifyToken(), bcrypt, express, jwt (+21 more)

### Community 3 - "excelParser.js"
Cohesion: 0.13
Nodes (29): xlsx, cellStr(), detectItemHeaderMap(), extractPaymentUnit(), firstNonEmptyIdx(), isCloseRow(), isJobHeaderRow(), ITEM_HEADER_ALIASES (+21 more)

### Community 4 - "complain.routes.js"
Cohesion: 0.10
Nodes (25): complaintStorage, computePeriode(), express, fs, getComplaintForPdf(), getComplaintForPdf2(), multer, path (+17 more)

### Community 5 - "survey.routes.js"
Cohesion: 0.07
Nodes (22): multer, ALLOWED_MIME, maxSizeMb, multer, upload, express, fs, multer (+14 more)

### Community 6 - "surveyView.routes.js"
Cohesion: 0.16
Nodes (26): analisaColumnHeight(), COL, colX(), computePhotoCapacityPerChunk(), drawAnalisaColumn(), drawAreaRow(), drawAreaRowSingle(), drawAreaRowSplit() (+18 more)

### Community 7 - "upload.routes.js"
Cohesion: 0.11
Nodes (20): pdf-parse, { parseHspkText }, parsePdfBuffer(), pdfParse, express, { importParsedData }, { parseExcelBuffer }, { parsePdfBuffer } (+12 more)

### Community 8 - "timeScheduleExportHelper.js"
Cohesion: 0.15
Nodes (21): {
  buildTimeScheduleSheet,
}, ExcelJS, express, prisma, router, autoFitColumn(), buildTimeScheduleSheet(), weeklyWeightOf() (+13 more)

### Community 9 - "crudGrub/bast.routes.js"
Cohesion: 0.12
Nodes (15): pdfkit, bastStorage, express, fs, multer, path, prisma, router (+7 more)

### Community 10 - "tsView.routes.js"
Cohesion: 0.22
Nodes (17): blankRow(), computeScheduleData(), weeklyWeightOf(), weightOf(), escapeHtml(), express, fmt2(), fmtDate() (+9 more)

### Community 11 - "parseHspkText"
Cohesion: 0.23
Nodes (13): cleanName(), isMissingValueToken(), isNumericToken(), MISSING_VALUE_TOKENS, parseCoefficientLine(), parsePriceLine(), popTrailingNumbers(), tokenize() (+5 more)

### Community 12 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, bcrypt, cors, dotenv, exceljs, express, jsonwebtoken, multer (+7 more)

### Community 13 - "complainView(bast_2).routes.js"
Cohesion: 0.26
Nodes (14): buildColumns(), colX(), computeRowHeight(), drawCategoryBar(), drawHeader(), drawItemRow(), drawPhotoGroup(), drawTableHeader() (+6 more)

### Community 14 - "index.js"
Cohesion: 0.14
Nodes (13): app, bv, clientsRouter, cors, exportExcel, express, hspkRouter, jobsRoutes (+5 more)

### Community 15 - "bvView.routes.js"
Cohesion: 0.22
Nodes (13): buildRows(), getRow(), writeItem(), bvItemInclude, escapeHtml(), express, fmtNum(), newRow() (+5 more)

### Community 16 - "app1.js"
Cohesion: 0.17
Nodes (9): clientNameInput, clientNameWrap, clientSelect, errorMsg, form, periodHint, periodSelect, submitBtn (+1 more)

### Community 17 - "rabView.routes.js"
Cohesion: 0.31
Nodes (8): escapeHtml(), express, fmtRp(), prisma, renderRabHtml(), ROMAN, router, sumRecursive()

### Community 18 - "bv.routes.js"
Cohesion: 0.29
Nodes (6): buildBreakdownRows(), calcBreakdownSubtotal(), { calculateJobPrice }, express, prisma, router

### Community 19 - "jobs.routes.js"
Cohesion: 0.29
Nodes (6): { calculateJobPrice }, express, prisma, router, calculateJobPrice(), prisma

### Community 20 - "server.js"
Cohesion: 0.29
Nodes (6): app, clientsRouter, express, hspkRouter, path, projectsRouter

### Community 21 - "lib/prisma.js"
Cohesion: 0.33
Nodes (4): { PrismaClient }, express, prisma, router

### Community 22 - "rabGrub.routes.js"
Cohesion: 0.40
Nodes (3): express, prisma, router

### Community 23 - "samoah/clients.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 24 - "samoah/hspk.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 25 - "samoah/projects.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 27 - "routes/clients.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 28 - "routes/hspk.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 29 - "routes/projects.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

## Knowledge Gaps
- **251 isolated node(s):** `description`, `nodemon`, `prisma`, `main`, `name` (+246 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 277 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `multer` connect `survey.routes.js` to `package.json`, `crudGrub/bast.routes.js`, `rab.routes.js`, `complain.routes.js`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `pdfkit` connect `crudGrub/bast.routes.js` to `package.json`, `complain.routes.js`, `complainView(bast_2).routes.js`, `surveyView.routes.js`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `description`, `nodemon`, `prisma` to the rest of the system?**
  _251 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04756871035940803 - nodes in this community are weakly interconnected._
- **Should `fullExport.routes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06794871794871794 - nodes in this community are weakly interconnected._
- **Should `rab.routes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06156156156156156 - nodes in this community are weakly interconnected._