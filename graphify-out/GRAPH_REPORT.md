# Graph Report - hspk-ahsp-importer  (2026-09-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 586 nodes · 809 edges · 77 communities (46 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0680fd18`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- upload.routes.js
- excelParser.js
- complain.routes.js
- lapangan.routes.js
- survey.routes.js
- surveyView.routes.js
- 20260902091156_sync_existing_schema/migration.sql
- timeScheduleExportHelper.js
- crudGrub/bast.routes.js
- "RabItem"
- tsView.routes.js
- dependencies
- complainView(bast_2).routes.js
- index.js
- bvView.routes.js
- package.json
- app1.js
- samoah/package.json
- rabExportHelper.js
- exceljs
- rab.routes.js
- rabView.routes.js
- bvExportHelper.js
- 20260710104326_add_client_and_project/migration.sql
- bv.routes.js
- fullExport.routes.js
- jobs.routes.js
- scripts
- server.js
- 20260710092835_init/migration.sql
- 20260823144445_add_survey_photos/migration.sql
- lib/prisma.js
- supplier.route.js
- bvExport.routes.js
- rabExport.routes.js
- scripts
- rabGrub.routes.js
- samoah/clients.js
- samoah/hspk.js
- dependencies
- samoah/projects.js
- summarize-issues.js
- routes/clients.js
- routes/hspk.js
- routes/projects.js
- devDependencies
- devDependencies
- 20260718091941_add_discipline_grade/migration.sql
- samoah/prisma.js
- "PriceItem"
- "JobType"
- "JobType"
- "Project"
- "Project"
- "Project"

## God Nodes (most connected - your core abstractions)
1. `parseAhspSheet()` - 15 edges
2. `buildTimeScheduleSheet()` - 14 edges
3. `parseHspkText()` - 11 edges
4. `drawAreaRowSplit()` - 11 edges
5. `streamComplaintPdff()` - 10 edges
6. `streamComplaintPdf()` - 10 edges
7. `renderScheduleHtml()` - 9 edges
8. `"RabItem"` - 9 edges
9. `cellStr()` - 8 edges
10. `parseExcelBuffer()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `parseExcelBuffer()` --calls--> `parseHspkText()`  [EXTRACTED]
  src/parsers/excelParser.js → src/parsers/textStateParser.js
- `"TimeSchedule"` --references--> `"RabItem"`  [EXTRACTED]
  prisma/migrations/20260728135454_add_time_schedule/migration.sql → prisma/migrations/20260713042057_add_rab_item/migration.sql
- `"DailyProgress"` --references--> `"RabItem"`  [EXTRACTED]
  prisma/migrations/20260805054957_add_daily_progress/migration.sql → prisma/migrations/20260713042057_add_rab_item/migration.sql
- `"BvBreakdown"` --references--> `"BvItem"`  [EXTRACTED]
  prisma/migrations/20260724024400_add_bv_breakdown/migration.sql → prisma/migrations/20260724011034_add_bv_item/migration.sql
- `parseHspkText()` --calls--> `parseCoefficientLine()`  [EXTRACTED]
  src/parsers/textStateParser.js → src/parsers/lineParser.js

## Import Cycles
- None detected.

## Communities (77 total, 9 thin omitted)

### Community 0 - "upload.routes.js"
Cohesion: 0.08
Nodes (33): pdf-parse, cleanName(), isMissingValueToken(), isNumericToken(), MISSING_VALUE_TOKENS, parseCoefficientLine(), parsePriceLine(), popTrailingNumbers() (+25 more)

### Community 1 - "excelParser.js"
Cohesion: 0.13
Nodes (29): xlsx, cellStr(), detectItemHeaderMap(), extractPaymentUnit(), firstNonEmptyIdx(), isCloseRow(), isJobHeaderRow(), ITEM_HEADER_ALIASES (+21 more)

### Community 2 - "complain.routes.js"
Cohesion: 0.10
Nodes (25): complaintStorage, computePeriode(), express, fs, getComplaintForPdf(), getComplaintForPdf2(), multer, path (+17 more)

### Community 3 - "lapangan.routes.js"
Cohesion: 0.07
Nodes (23): bcrypt, jsonwebtoken, jwt, verifyToken(), bcrypt, express, jwt, prisma (+15 more)

### Community 4 - "survey.routes.js"
Cohesion: 0.07
Nodes (22): multer, ALLOWED_MIME, maxSizeMb, multer, upload, express, fs, multer (+14 more)

### Community 5 - "surveyView.routes.js"
Cohesion: 0.17
Nodes (26): analisaColumnHeight(), COL, colX(), computePhotoCapacityPerChunk(), drawAnalisaColumn(), drawAreaRow(), drawAreaRowSingle(), drawAreaRowSplit() (+18 more)

### Community 6 - "20260902091156_sync_existing_schema/migration.sql"
Cohesion: 0.14
Nodes (18): "Bast", "BastPhoto", "ComplaintCategory", "ComplaintItem", "ComplaintPhoto", "ComplaintReport", "MaterialRequest", "MaterialRequestItem" (+10 more)

### Community 7 - "timeScheduleExportHelper.js"
Cohesion: 0.15
Nodes (21): {
  buildTimeScheduleSheet,
}, ExcelJS, express, prisma, router, autoFitColumn(), buildTimeScheduleSheet(), weeklyWeightOf() (+13 more)

### Community 8 - "crudGrub/bast.routes.js"
Cohesion: 0.12
Nodes (15): pdfkit, bastStorage, express, fs, multer, path, prisma, router (+7 more)

### Community 9 - ""RabItem""
Cohesion: 0.16
Nodes (12): "Client", "Project", "RabItem", "RabItemComponent", "RabGroup", "Project", "BvItem", "Project" (+4 more)

### Community 10 - "tsView.routes.js"
Cohesion: 0.22
Nodes (17): blankRow(), computeScheduleData(), weeklyWeightOf(), weightOf(), escapeHtml(), express, fmt2(), fmtDate() (+9 more)

### Community 11 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, bcrypt, cors, dotenv, exceljs, express, jsonwebtoken, multer (+7 more)

### Community 12 - "complainView(bast_2).routes.js"
Cohesion: 0.26
Nodes (14): buildColumns(), colX(), computeRowHeight(), drawCategoryBar(), drawHeader(), drawItemRow(), drawPhotoGroup(), drawTableHeader() (+6 more)

### Community 13 - "index.js"
Cohesion: 0.14
Nodes (13): app, bv, clientsRouter, cors, exportExcel, express, hspkRouter, jobsRoutes (+5 more)

### Community 14 - "bvView.routes.js"
Cohesion: 0.22
Nodes (13): buildRows(), getRow(), writeItem(), bvItemInclude, escapeHtml(), express, fmtNum(), newRow() (+5 more)

### Community 15 - "package.json"
Cohesion: 0.17
Nodes (11): description, express, nodemon, main, name, type, version, cors (+3 more)

### Community 16 - "app1.js"
Cohesion: 0.17
Nodes (9): clientNameInput, clientNameWrap, clientSelect, errorMsg, form, periodHint, periodSelect, submitBtn (+1 more)

### Community 17 - "samoah/package.json"
Cohesion: 0.20
Nodes (9): dotenv, prisma, @prisma/client, description, express, nodemon, main, name (+1 more)

### Community 18 - "rabExportHelper.js"
Cohesion: 0.33
Nodes (8): autoFitColumn(), buildRabSheet(), writeItem(), colRange(), fmt(), fmtVol(), prisma, ROMAN

### Community 19 - "exceljs"
Cohesion: 0.22
Nodes (4): exceljs, ExcelJS, ExcelJS, prisma

### Community 20 - "rab.routes.js"
Cohesion: 0.22
Nodes (5): { calculateJobPrice }, express, prisma, router, { verifyToken, authorizeRoles }

### Community 21 - "rabView.routes.js"
Cohesion: 0.31
Nodes (8): escapeHtml(), express, fmtRp(), prisma, renderRabHtml(), ROMAN, router, sumRecursive()

### Community 22 - "bvExportHelper.js"
Cohesion: 0.28
Nodes (6): autoFitColumn(), buildBvSheet(), bvItemInclude, colRange(), prisma, ROMAN

### Community 23 - "20260710104326_add_client_and_project/migration.sql"
Cohesion: 0.46
Nodes (7): "Client", "JobComponent", "JobType", "PriceItem", "Project", "UploadBatch", "UploadIssue"

### Community 24 - "bv.routes.js"
Cohesion: 0.29
Nodes (6): buildBreakdownRows(), calcBreakdownSubtotal(), { calculateJobPrice }, express, prisma, router

### Community 25 - "fullExport.routes.js"
Cohesion: 0.25
Nodes (7): { buildBvSheet }, { buildRabSheet }, {
  buildTimeScheduleSheet,
}, ExcelJS, express, prisma, router

### Community 26 - "jobs.routes.js"
Cohesion: 0.29
Nodes (6): { calculateJobPrice }, express, prisma, router, calculateJobPrice(), prisma

### Community 27 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, dev, generate-docs, prisma:generate, prisma:migrate, prisma:studio, start

### Community 28 - "server.js"
Cohesion: 0.29
Nodes (6): app, clientsRouter, express, hspkRouter, path, projectsRouter

### Community 29 - "20260710092835_init/migration.sql"
Cohesion: 0.67
Nodes (5): "JobComponent", "JobType", "PriceItem", "UploadBatch", "UploadIssue"

### Community 30 - "20260823144445_add_survey_photos/migration.sql"
Cohesion: 0.53
Nodes (5): "Project", "SurveyArea", "SurveyDimension", "SurveyPhoto", "SurveyReport"

### Community 31 - "lib/prisma.js"
Cohesion: 0.33
Nodes (4): { PrismaClient }, express, prisma, router

### Community 32 - "supplier.route.js"
Cohesion: 0.33
Nodes (5): express, prisma, router, supplierService, { verifyToken, authorizeRoles }

### Community 33 - "bvExport.routes.js"
Cohesion: 0.33
Nodes (5): { buildBvSheet }, ExcelJS, express, prisma, router

### Community 34 - "rabExport.routes.js"
Cohesion: 0.33
Nodes (5): { buildRabSheet }, ExcelJS, express, prisma, router

### Community 35 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, dev, prisma:generate, prisma:migrate, start

### Community 36 - "rabGrub.routes.js"
Cohesion: 0.40
Nodes (3): express, prisma, router

### Community 37 - "samoah/clients.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 38 - "samoah/hspk.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 39 - "dependencies"
Cohesion: 0.50
Nodes (4): dependencies, dotenv, express, @prisma/client

### Community 40 - "samoah/projects.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 42 - "routes/clients.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 43 - "routes/hspk.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 44 - "routes/projects.js"
Cohesion: 0.50
Nodes (3): express, prisma, router

### Community 45 - "devDependencies"
Cohesion: 0.67
Nodes (3): devDependencies, nodemon, prisma

### Community 46 - "devDependencies"
Cohesion: 0.67
Nodes (3): devDependencies, nodemon, prisma

## Knowledge Gaps
- **260 isolated node(s):** `MISSING_VALUE_TOKENS`, `{ parsePriceLine, parseCoefficientLine }`, `{ parseHspkText }`, `express`, `{ importParsedData }` (+255 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 327 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `multer` connect `survey.routes.js` to `crudGrub/bast.routes.js`, `complain.routes.js`, `lapangan.routes.js`, `package.json`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `exceljs` connect `exceljs` to `bvExport.routes.js`, `rabExport.routes.js`, `timeScheduleExportHelper.js`, `package.json`, `fullExport.routes.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `pdfkit` connect `crudGrub/bast.routes.js` to `complain.routes.js`, `complainView(bast_2).routes.js`, `surveyView.routes.js`, `package.json`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **What connects `MISSING_VALUE_TOKENS`, `{ parsePriceLine, parseCoefficientLine }`, `{ parseHspkText }` to the rest of the system?**
  _260 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `upload.routes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07804878048780488 - nodes in this community are weakly interconnected._
- **Should `excelParser.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13306451612903225 - nodes in this community are weakly interconnected._
- **Should `complain.routes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10098522167487685 - nodes in this community are weakly interconnected._