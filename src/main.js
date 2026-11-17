import './styles/main.css';

import { EngineModel } from './models/EngineModel.js';
import { DocumentModel } from './models/DocumentModel.js';
import { ThemeModel } from './models/ThemeModel.js';

import { EngineView } from './views/EngineView.js';
import { UploadView } from './views/UploadView.js';
import { PagesView } from './views/PagesView.js';
import { ThemeView } from './views/ThemeView.js';

import { EngineController } from './controllers/EngineController.js';
import { DocumentController } from './controllers/DocumentController.js';
import { ThemeController } from './controllers/ThemeController.js';

import { OcrEngine } from './services/OcrEngine.js';

// --- Composition root: wire Models ⇄ Controllers ⇄ Views ---
const engineView = new EngineView();
const engine = new OcrEngine({ onLog: (level, text) => engineView.appendLog(level, text) });
const engineModel = new EngineModel();
const docs = new DocumentModel();

new ThemeController({ model: new ThemeModel(), view: new ThemeView() });
const engineCtl = new EngineController({ model: engineModel, view: engineView, engine });
new DocumentController({ docs, engineModel, engine, uploadView: new UploadView(), pagesView: new PagesView() });

engineCtl.init();

// Expose for debugging / automated smoke tests.
window.__ocr = { engine, engineModel, docs };
