import { app } from 'electron'
import { join } from 'path'

// Imported first by src/main/index.js so it runs before any module reads
// app.getPath('userData') (src/main/db.js resolves the production DB path at load).
// The folder keeps its pre-rebrand name so upgraded installs keep their database
// and preferences (see .docs/DECISIONS.md D-005).
app.setPath('userData', join(app.getPath('appData'), 'elnagdi-pos'))
